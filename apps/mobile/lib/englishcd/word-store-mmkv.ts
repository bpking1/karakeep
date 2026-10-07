import { createMMKV } from "react-native-mmkv";

import type {
  CachedPhraseLibrary,
  CacheVersions,
  CachedWord,
  WordStore,
} from "./word-cache";

const WORD_PREFIX = "word:";
const SCOPE_KEY = "scope";
const VERSIONS_KEY = "versions";
const LIBRARY_KEY = "phrase-library";

const storage = createMMKV({ id: "englishcd-word-cache" });

// Not a secret: it only tells whether the stored results belong to this connection.
function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function read<T>(key: string): T | undefined {
  const raw = storage.getString(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.remove(key);
    return undefined;
  }
}

// Dictionary data and personal states only; never article text or the API key.
// Switching connections discards another server's results.
export function mmkvWordStore(url: string, apiKey: string): WordStore {
  const scope = `${url}|${fingerprint(apiKey)}`;
  if (storage.getString(SCOPE_KEY) !== scope) {
    storage.clearAll();
    storage.set(SCOPE_KEY, scope);
  }
  return {
    get: (input) => read<CachedWord>(WORD_PREFIX + input),
    put: (items) => {
      for (const item of items)
        storage.set(WORD_PREFIX + item.input, JSON.stringify(item));
    },
    expireStates: (match) => {
      for (const key of storage.getAllKeys()) {
        if (!key.startsWith(WORD_PREFIX)) continue;
        const info = read<CachedWord>(key);
        if (info && match(info))
          storage.set(key, JSON.stringify({ ...info, readAt: -1 }));
      }
    },
    clear: () => {
      storage.clearAll();
      storage.set(SCOPE_KEY, scope);
    },
    versions: () => read<CacheVersions>(VERSIONS_KEY) ?? null,
    setVersions: (versions) =>
      storage.set(VERSIONS_KEY, JSON.stringify(versions)),
    library: () => read<CachedPhraseLibrary>(LIBRARY_KEY) ?? null,
    setLibrary: (library) => storage.set(LIBRARY_KEY, JSON.stringify(library)),
  };
}
