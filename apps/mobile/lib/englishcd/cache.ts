import type { WordInfo } from "./types";
import {
  memoryWordStore,
  needsState,
  nextVersions,
  ownWriteExplains,
  versionChange,
  withState,
  writtenBy,
  type CachedWord,
  type CacheVersions,
  type LibraryPhrase,
  type WordStateItem,
  type WordStore,
  type WordVersions,
} from "./word-cache";

export type ServerVersions = WordVersions & { phraseLibraryVersion?: string };

// The client's requests; the cache owns no HTTP, credentials or article text.
export interface WordCacheRequests {
  lookup(words: string[]): Promise<{ items: WordInfo[] } & WordVersions>;
  states(words: string[]): Promise<{ items: WordStateItem[] } & WordVersions>;
  version(): Promise<ServerVersions>;
  phraseLibrary(): Promise<{ version: string; phrases: LibraryPhrase[] }>;
}

const BATCH = 500;

// Owned by one connection's client; the store outlives it (MMKV in the app).
// Mirrors EnglishCD extension/src/background/cache.ts: entries never expire by
// time, own writes re-read the written keys' states, another device's change
// re-reads unmastered dictionary words only, a new dictionary drops everything.
export class WordLookupCache {
  private versions: CacheVersions | null;
  private libraryVersion?: string;
  private checkedAt = -Infinity;
  private writes = 0;
  private generation = 0;

  constructor(
    private readonly requests: WordCacheRequests,
    private readonly store: WordStore = memoryWordStore(),
    private readonly now: () => number = Date.now,
  ) {
    this.versions = store.versions();
  }

  // Closing the client: late responses must not write into the store.
  close() {
    this.generation++;
  }

  // The stored result, if any, without a request (a card shows it at once).
  peek(word: string): WordInfo | undefined {
    return this.versions ? this.store.get(word) : undefined;
  }

  private apply(current: WordVersions) {
    const change = versionChange(this.versions, current);
    if (change === "untrusted" || change === "all") {
      if (change === "all") this.writes++;
      this.store.clear();
    }
    this.versions = nextVersions(this.versions, current);
    this.store.setVersions(this.versions);
  }

  // Returns true when another device changed words, so the reader should re-highlight.
  async sync(force = false): Promise<boolean> {
    if (!force && this.now() - this.checkedAt < 30_000) return false;
    this.checkedAt = this.now();
    const generation = this.generation;
    try {
      const current = await this.requests.version();
      if (generation !== this.generation) return false;
      this.libraryVersion = current.phraseLibraryVersion;
      const change = versionChange(this.versions, current);
      this.apply(current);
      return change === "all" || change === "unsettled";
    } catch {
      // Offline: keep serving the cache; the next check reconciles it.
      return false;
    }
  }

  // Own writes keep dictionary data and re-read the written keys and inflections.
  async written(keys: string[], revision?: number) {
    this.writes++;
    this.store.expireStates(writtenBy(keys));
    if (!ownWriteExplains(this.versions, revision)) await this.sync(true);
    else if (revision! > this.versions!.vocabularyRevision) {
      this.versions = { ...this.versions!, vocabularyRevision: revision! };
      this.store.setVersions(this.versions);
    }
  }

  // The fixed phrase candidates, kept until the server's library version changes.
  async phraseLibrary(): Promise<LibraryPhrase[]> {
    await this.sync();
    const stored = this.store.library();
    if (
      stored &&
      (this.libraryVersion === undefined ||
        stored.version === this.libraryVersion)
    )
      return stored.phrases;
    const generation = this.generation;
    const list = await this.requests.phraseLibrary();
    if (!Array.isArray(list.phrases)) throw new Error("短语库响应不完整");
    if (generation === this.generation)
      this.store.setLibrary({ version: list.version, phrases: list.phrases });
    return list.phrases;
  }

  // `fresh` (an explicitly opened word card) asks the server and refreshes the cache.
  async lookup(words: string[], fresh = false): Promise<WordInfo[]> {
    const generation = this.generation;
    await this.sync();
    const unique = [...new Set(words)];
    const found = new Map<string, WordInfo>();
    const stale: CachedWord[] = [];
    if (!fresh && this.versions) {
      for (const word of unique) {
        const info = this.store.get(word);
        if (!info) continue;
        if (needsState(info, this.versions)) stale.push(info);
        else found.set(word, info);
      }
    }
    for (let offset = 0; offset < stale.length; offset += BATCH) {
      const batch = stale.slice(offset, offset + BATCH);
      const written = this.writes;
      const result = await this.requests.states(
        batch.map((info) => info.input),
      );
      if (generation !== this.generation)
        throw new Error("EnglishCD 连接已关闭");
      if (!Array.isArray(result.items))
        throw new Error("词汇状态响应缺少 items");
      // A new dictionary means the kept data is outdated too: look these up in full.
      if (versionChange(this.versions, result) === "all") {
        this.apply(result);
        continue;
      }
      const byInput = new Map(result.items.map((item) => [item.input, item]));
      const merged = batch.flatMap((info) => {
        const state = byInput.get(info.input);
        return state ? [withState(info, state, result.vocabularyRevision)] : [];
      });
      for (const info of merged) found.set(info.input, info);
      const newer = versionChange(this.versions, result) !== "none";
      if (newer) this.apply(result);
      if (newer || written === this.writes) this.store.put(merged);
    }
    const missing = unique.filter((word) => !found.has(word));
    for (let offset = 0; offset < missing.length; offset += BATCH) {
      const written = this.writes;
      const result = await this.requests.lookup(
        missing.slice(offset, offset + BATCH),
      );
      if (generation !== this.generation)
        throw new Error("EnglishCD 连接已关闭");
      if (!Array.isArray(result.items))
        throw new Error("词汇查询响应缺少 items");
      // Never store part of a batch: a missing word fails the whole lookup.
      const answered = new Set(result.items.map((info) => info.input));
      if (missing.slice(offset, offset + BATCH).some((w) => !answered.has(w)))
        throw new Error("词汇查询结果不完整，请手动重试");
      const items = result.items.map((info) => ({
        ...info,
        readAt: result.vocabularyRevision,
      }));
      for (const item of items) found.set(item.input, item);
      // Results read at a newer revision are fresh; otherwise results read
      // before a later own write must not overwrite the expired entries.
      const newer = versionChange(this.versions, result) !== "none";
      if (newer) this.apply(result);
      if (newer || written === this.writes) this.store.put(items);
    }
    return words.map((word) => {
      const item = found.get(word);
      if (!item) throw new Error("词汇查询结果不完整，请手动重试");
      return item;
    });
  }
}
