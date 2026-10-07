import type { WordInfo } from "./types";

// Adapted from EnglishCD shared/word-cache.ts and shared/word-storage.ts (2026-09-30).
// Lookup results never expire by time: dictionary data changes only with the
// dictionary version, and only the personal fields are re-read via /words/states.

export interface WordVersions {
  vocabularyRevision: number;
  dictionaryVersion: string;
}

// Server versions the stored results match. Unmastered states read before
// staleBefore were possibly changed by another device.
export type CacheVersions = WordVersions & { staleBefore: number };

// A lookup result and the vocabulary revision its state was read at; -1 marks
// a state this client wrote since, which must be re-read.
export type CachedWord = WordInfo & { readAt: number };

// The personal fields of a lookup, as returned by POST /words/states.
export type WordStateItem = Pick<
  WordInfo,
  "input" | "termKey" | "state" | "collected"
>;

// GET /words/phrase-library item: fixed candidates without personal state.
export interface LibraryPhrase {
  text: string;
  termKey?: string;
}
export interface CachedPhraseLibrary {
  version: string;
  phrases: LibraryPhrase[];
}

// Durable lookup results keyed by surface word. MMKV is synchronous, so unlike
// the Web/extension IndexedDB storage this port is too.
export interface WordStore {
  get(input: string): CachedWord | undefined;
  put(items: CachedWord[]): void;
  // Keeps dictionary data; only the personal state is re-read.
  expireStates(match: (info: CachedWord) => boolean): void;
  clear(): void;
  versions(): CacheVersions | null;
  setVersions(versions: CacheVersions): void;
  library(): CachedPhraseLibrary | null;
  setLibrary(library: CachedPhraseLibrary): void;
}

export function memoryWordStore(): WordStore {
  const words = new Map<string, CachedWord>();
  let saved: CacheVersions | null = null;
  let phrases: CachedPhraseLibrary | null = null;
  return {
    get: (input) => words.get(input),
    put: (items) => {
      for (const item of items) words.set(item.input, item);
    },
    expireStates: (match) => {
      for (const [input, info] of words)
        if (match(info)) words.set(input, { ...info, readAt: -1 });
    },
    clear: () => {
      words.clear();
      saved = null;
      phrases = null;
    },
    versions: () => saved,
    setVersions: (versions) => {
      saved = versions;
    },
    library: () => phrases,
    setLibrary: (library) => {
      phrases = library;
    },
  };
}

// A learnable word: the dictionary has it, or the user gave it a state or saved
// it. Brands, user names and typos are otherwise skipped everywhere
// (highlighting, study lists) and never re-read from the server.
export function dictionaryWord(info: WordInfo) {
  return info.entry != null || info.state !== "unknown" || info.collected;
}

// Mastered and set-aside words are not highlighted; a remote change never expires them.
export function settledWord(info: WordInfo | null | undefined) {
  return info?.state === "known" || info?.state === "ignored";
}

// An own write marks the written keys and every surface inheriting from them.
export function writtenBy(keys: Iterable<string>) {
  const written = new Set(keys);
  return (info: WordInfo) =>
    written.has(info.termKey) ||
    (info.lemmaCandidates ?? []).some((key) => written.has(key));
}

// Another device's change re-reads only unmastered dictionary words.
export function remoteRefreshable(info: WordInfo) {
  return !settledWord(info) && dictionaryWord(info);
}

export function needsState(info: CachedWord, versions: CacheVersions) {
  return (
    info.readAt < 0 ||
    (remoteRefreshable(info) && info.readAt < versions.staleBefore)
  );
}

export function withState(
  info: CachedWord,
  state: WordStateItem,
  readAt: number,
): CachedWord {
  return { ...info, state: state.state, collected: state.collected, readAt };
}

// untrusted: nothing ties stored results to server versions yet.
// all: a new dictionary or a restored server; unsettled: another device wrote.
export type VersionChange = "none" | "unsettled" | "all" | "untrusted";

export function versionChange(
  known: WordVersions | null,
  current: WordVersions,
): VersionChange {
  if (!known) return "untrusted";
  if (
    known.dictionaryVersion !== current.dictionaryVersion ||
    current.vocabularyRevision < known.vocabularyRevision
  )
    return "all";
  return current.vocabularyRevision > known.vocabularyRevision
    ? "unsettled"
    : "none";
}

// The versions after a detected change; another device's writes only move staleBefore.
export function nextVersions(
  known: CacheVersions | null,
  current: WordVersions,
): CacheVersions {
  const change = versionChange(known, current);
  return {
    vocabularyRevision: current.vocabularyRevision,
    dictionaryVersion: current.dictionaryVersion,
    staleBefore:
      change === "unsettled"
        ? current.vocabularyRevision
        : change === "none"
          ? known!.staleBefore
          : 0,
  };
}

// A changing write bumps the revision by exactly one; anything more means
// another device also wrote in between.
export function ownWriteExplains(
  known: WordVersions | null,
  revision: number | undefined,
) {
  return (
    known !== null &&
    revision !== undefined &&
    revision <= known.vocabularyRevision + 1
  );
}
