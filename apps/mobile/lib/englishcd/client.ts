import { WordLookupCache, type ServerVersions } from "./cache";
import { mergePhrases } from "./phrases";
import type {
  Capabilities,
  CaptureRequest,
  CaptureResult,
  CollectedPhrase,
  DictionaryLookupResult,
  EnglishCDConnection,
  ImportRequest,
  ImportResult,
  SetStatesResult,
  StartLearningResult,
  TranslationResult,
  WordInfo,
  WordState,
} from "./types";
import type {
  LibraryPhrase,
  WordStateItem,
  WordStore,
  WordVersions,
} from "./word-cache";

export function normalizeConnection(
  value: EnglishCDConnection,
): EnglishCDConnection {
  const apiKey = value.apiKey.trim();
  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("请输入完整的 EnglishCD HTTP(S) 根地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "EnglishCD 地址须为 HTTP(S) 根地址，可包含部署子路径，不含凭据、查询或片段",
    );
  }
  if (!apiKey || /[\r\n]/.test(apiKey))
    throw new Error("请填写有效的 EnglishCD API Token");
  return { url: url.toString().replace(/\/+$/, ""), apiKey };
}

function idempotencyKey(key: string) {
  if (key.length < 8 || key.length > 128 || /[\r\n]/.test(key)) {
    throw new Error("请求标识无效，请重新打开当前操作");
  }
  return key;
}

// The only EnglishCD fetch owner. One instance is a connection snapshot;
// replacing/closing it cancels its requests. Lookup results persist in the
// injected store (MMKV in the app) under the shared EnglishCD cache rules.
export class EnglishCDClient {
  private readonly connection: EnglishCDConnection;
  private readonly cache: WordLookupCache;
  private readonly requests = new Set<AbortController>();
  private closed = false;
  private phraseRequest?: Promise<CollectedPhrase[]>;
  private phraseCache?: { items: CollectedPhrase[]; expires: number };
  private generation = 0;

  constructor(connection: EnglishCDConnection, store?: WordStore) {
    this.connection = normalizeConnection(connection);
    this.cache = new WordLookupCache(
      {
        lookup: (words) =>
          this.request<{ items: WordInfo[] } & WordVersions>(
            "/words/lookup",
            "POST",
            { words },
          ),
        states: (words) =>
          this.request<{ items: WordStateItem[] } & WordVersions>(
            "/words/states",
            "POST",
            { words },
          ),
        version: () => this.request<ServerVersions>("/vocabulary/version"),
        phraseLibrary: () =>
          this.request<{ version: string; phrases: LibraryPhrase[] }>(
            "/words/phrase-library",
          ),
      },
      store,
    );
  }

  private dropPhrases() {
    this.generation++;
    this.phraseCache = undefined;
    this.phraseRequest = undefined;
  }

  // Returning to the reader: re-read personal phrases and check whether another
  // device changed words. Cached dictionary data is kept.
  refresh(): Promise<boolean> {
    this.dropPhrases();
    return this.cache.sync(true);
  }

  // An own write: only the written keys' personal state is re-read.
  private async written(keys: string[], revision?: number) {
    this.dropPhrases();
    await this.cache.written(
      keys.filter((key) => key.trim()),
      revision,
    );
  }

  close() {
    this.closed = true;
    this.dropPhrases();
    this.cache.close();
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }

  capabilities() {
    return this.request<Capabilities>("/capabilities");
  }

  // `fresh` skips the cache (an explicitly opened word card) and refreshes it.
  lookup(words: string[], fresh = false): Promise<WordInfo[]> {
    if (this.closed) return Promise.reject(new Error("EnglishCD 连接已关闭"));
    if (!words.length) return Promise.resolve([]);
    if (words.some((word) => typeof word !== "string" || !word.trim())) {
      return Promise.reject(new Error("词语不能为空"));
    }
    return this.cache.lookup(words, fresh);
  }

  // The cached lookup, if any, shown at once while a fresh read is in flight.
  cachedWord(word: string): WordInfo | undefined {
    return this.closed ? undefined : this.cache.peek(word);
  }

  // Highlight candidates: the phrase library merged with the user's own phrases
  // (saved or given a state), whose states decide highlighting.
  async phrases(): Promise<CollectedPhrase[]> {
    const [library, personal] = await Promise.all([
      this.cache.phraseLibrary().catch((): LibraryPhrase[] => []),
      this.personalPhrases(),
    ]);
    return mergePhrases(library, personal);
  }

  private async personalPhrases(): Promise<CollectedPhrase[]> {
    if (this.closed) throw new Error("EnglishCD 连接已关闭");
    if (this.phraseCache && this.phraseCache.expires > Date.now())
      return this.phraseCache.items;
    if (this.phraseRequest) return this.phraseRequest;
    const generation = this.generation;
    const pending = this.readPhrases()
      .then((items) => {
        if (generation === this.generation)
          this.phraseCache = { items, expires: Date.now() + 30_000 };
        return items;
      })
      .finally(() => {
        if (this.phraseRequest === pending) this.phraseRequest = undefined;
      });
    this.phraseRequest = pending;
    return pending;
  }

  private async readPhrases() {
    const items: CollectedPhrase[] = [];
    const cursors = new Set<string>();
    let cursor = "";
    do {
      if (cursors.has(cursor)) throw new Error("收藏短语分页重复，请手动重试");
      cursors.add(cursor);
      const result = await this.request<{
        items: CollectedPhrase[];
        nextCursor: string | null;
      }>(`/words/phrases?limit=200&cursor=${encodeURIComponent(cursor)}`);
      if (
        !Array.isArray(result.items) ||
        (result.nextCursor !== null && typeof result.nextCursor !== "string")
      ) {
        throw new Error("收藏短语响应不完整");
      }
      items.push(...result.items);
      if (items.length > 10000)
        throw new Error("收藏短语超过 10000 条，未加载不完整列表");
      cursor = result.nextCursor || "";
    } while (cursor);
    return items;
  }

  async record(text: string, targetLanguage = "zh-CN") {
    const result = await this.request<DictionaryLookupResult>(
      `/dictionary-lookups/${encodeURIComponent(text)}?targetLanguage=${encodeURIComponent(targetLanguage)}`,
    );
    if (
      !Object.prototype.hasOwnProperty.call(result, "record") ||
      result.record === undefined
    ) {
      throw new Error("查词记录响应缺少 record 字段");
    }
    if (
      result.record !== null &&
      (typeof result.record !== "object" ||
        typeof result.record.text !== "string" ||
        typeof result.record.termKey !== "string" ||
        typeof result.record.targetLanguage !== "string" ||
        typeof result.record.updatedAt !== "string")
    ) {
      throw new Error("查词记录响应不完整");
    }
    return result;
  }

  translate(
    text: string,
    paragraphs: string,
    purpose: "dictionary" | "translation" = "dictionary",
    targetLanguage = "zh-CN",
  ) {
    return this.request<TranslationResult>(
      "/translations",
      "POST",
      { text, paragraphs, purpose, targetLanguage },
      "",
      95_000,
    );
  }

  visit(term: string, key: string) {
    return this.request<void>(
      "/word-visits",
      "POST",
      { term },
      idempotencyKey(key),
    );
  }

  async setState(termKey: string, state: WordState) {
    const result = await this.request<{
      term: { termKey: string; state: WordState };
      vocabularyRevision: number;
    }>("/vocabulary/state", "PUT", { termKey, state });
    // The server writes the base form; refresh the whole family through it.
    await this.written(
      [termKey, result.term?.termKey ?? ""],
      result.vocabularyRevision,
    );
    return result;
  }

  async setStates(terms: string[], state: WordState) {
    const result = await this.request<SetStatesResult>(
      "/vocabulary/states",
      "PUT",
      { terms, state },
    );
    await this.written(result.terms ?? terms, result.vocabularyRevision);
    return result;
  }

  async learning(terms: string[]) {
    const result = await this.request<StartLearningResult>(
      "/vocabulary/learning",
      "POST",
      { terms },
    );
    await this.written(result.terms ?? terms, result.vocabularyRevision);
    return result;
  }

  async capture(payload: CaptureRequest, key: string) {
    const result = await this.request<CaptureResult>(
      "/captures",
      "POST",
      payload,
      idempotencyKey(key),
    );
    await this.written(
      payload.termKey ? [payload.termKey] : [],
      result.vocabularyRevision,
    );
    return result;
  }

  async import(payload: ImportRequest, key: string) {
    const result = await this.request<ImportResult>(
      "/imports",
      "POST",
      payload,
      idempotencyKey(key),
    );
    if (!result.contentId || !result.trackId || result.kind !== "text") {
      throw new Error("导入响应缺少资料信息，请到 EnglishCD 资料库确认结果");
    }
    return result;
  }

  libraryURL(result: ImportResult) {
    return `${this.connection.url}/#/library/${encodeURIComponent(result.contentId)}?track=${encodeURIComponent(result.trackId)}`;
  }

  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    key = "",
    timeout = 30_000,
  ): Promise<T> {
    if (this.closed) throw new Error("EnglishCD 连接已关闭");
    const controller = new AbortController();
    this.requests.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.connection.apiKey}`,
      Accept: "application/json",
      "Cache-Control": "no-store",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
    try {
      const response = await fetch(`${this.connection.url}/api/v1${path}`, {
        method,
        headers,
        ...(method !== "GET" && body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
      });
      if (this.closed) throw new Error("EnglishCD 连接已关闭");
      if (response.status === 204 && response.ok) return undefined as T;
      const text = await response.text();
      if (this.closed) throw new Error("EnglishCD 连接已关闭");
      let result: unknown;
      try {
        result = JSON.parse(text);
      } catch {
        /* Do not display proxy HTML or request details. */
      }
      if (!response.ok) {
        const error = result as { error?: { message?: unknown } } | undefined;
        throw new Error(
          typeof error?.error?.message === "string"
            ? error.error.message
            : `EnglishCD 请求失败（${response.status}）`,
        );
      }
      if (result === undefined || result === null || typeof result !== "object")
        throw new Error("EnglishCD 返回了无效的 JSON 响应");
      return result as T;
    } catch (error) {
      const message = timedOut
        ? "EnglishCD 请求超时，请手动重试"
        : error instanceof Error
          ? error.message
          : "EnglishCD 网络请求失败";
      throw new Error(
        message
          .split(this.connection.apiKey)
          .join("[已隐藏]")
          .split(encodeURIComponent(this.connection.apiKey))
          .join("[已隐藏]"),
      );
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }
}
import { fetch } from "expo/fetch";
