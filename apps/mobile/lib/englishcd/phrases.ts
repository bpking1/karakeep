import type { CollectedPhrase } from "./types";
import { utf8ByteLength, wordsIn } from "./reading";

// Adapted from EnglishCD shared/phrases.ts: only saved, continuous phrases,
// longest first. No dictionary enumeration or local lemma inference.
export type ReadingToken = ReturnType<typeof wordsIn>[number] & {
  phrase?: string;
};
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[’ʼ]/g, "'")
    .replace(/\s+/g, " ");

export function phraseMatcher(phrases: readonly CollectedPhrase[]) {
  const byFirst = new Map<string, { key: string; words: string[] }[]>();
  for (const phrase of phrases) {
    if (phrase.state === "known" || phrase.state === "ignored") continue;
    const key = normalize(phrase.termKey);
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
