import type { CollectedPhrase } from "./types";
import { utf8ByteLength, wordsIn } from "./reading";
import type { LibraryPhrase } from "./word-cache";

// Adapted from EnglishCD shared/phrases.ts: the server's phrase library plus the
// user's own phrases, continuous and longest first. No local lemma inference.
export type ReadingToken = ReturnType<typeof wordsIn>[number] & {
  phrase?: string;
};
const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/[’ʼ]/g, "'").replace(/\s+/g, " ");

// Library phrases start unknown; the user's own phrases (saved or given a state)
// override their state and add phrases missing from the library.
export function mergePhrases(
  library: readonly LibraryPhrase[],
  personal: readonly CollectedPhrase[],
): CollectedPhrase[] {
  const states = new Map(
    personal.map((phrase) => [phrase.termKey, phrase.state]),
  );
  const merged: CollectedPhrase[] = library.map((phrase) => {
    const termKey = phrase.termKey ?? phrase.text;
    return {
      termKey,
      text: phrase.text,
      state: states.get(termKey) ?? "unknown",
    };
  });
  const texts = new Set(library.map((phrase) => phrase.text));
  for (const phrase of personal)
    if (!texts.has(normalize(phrase.termKey))) merged.push(phrase);
  return merged;
}

export function phraseMatcher(phrases: readonly CollectedPhrase[]) {
  const byFirst = new Map<string, { key: string; words: string[] }[]>();
  for (const phrase of phrases) {
    if (phrase.state === "known" || phrase.state === "ignored") continue;
    const key = normalize(phrase.text ?? phrase.termKey);
    const words = wordsIn(key).map((token) => token.word);
    if (
      words.length < 2 ||
      words.join(" ") !== key ||
      utf8ByteLength(key) > 128
    )
      continue;
    const candidates = byFirst.get(words[0]) ?? [];
    candidates.push({ key: phrase.termKey, words });
    byFirst.set(words[0], candidates);
  }
  for (const candidates of byFirst.values())
    candidates.sort((a, b) => b.words.length - a.words.length);
  return (text: string): ReadingToken[] => {
    const tokens = wordsIn(text);
    const result: ReadingToken[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const first = tokens[i];
      const match = byFirst.get(normalize(first.word))?.find((candidate) => {
        const last = tokens[i + candidate.words.length - 1];
        if (
          !last ||
          /[\p{L}\p{N}_]/u.test(text.slice(first.start - 1, first.start)) ||
          /[\p{L}\p{N}_]/u.test(text.slice(last.end, last.end + 1))
        )
          return false;
        return candidate.words.every(
          (word, n) =>
            normalize(tokens[i + n].word) === word &&
            (n === 0 ||
              /^\s+$/.test(
                text.slice(tokens[i + n - 1].end, tokens[i + n].start),
              )),
        );
      });
      if (!match) {
        result.push(first);
        continue;
      }
      const last = tokens[i + match.words.length - 1];
      result.push({
        word: text.slice(first.start, last.end),
        start: first.start,
        end: last.end,
        phrase: match.key,
      });
      i += match.words.length - 1;
    }
    return result;
  };
}
