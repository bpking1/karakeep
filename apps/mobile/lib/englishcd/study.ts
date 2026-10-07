import { dictionaryWord } from "./word-cache";
import {
  snapshotInText,
  utf8ByteLength,
  validateArticle,
  wordsIn,
} from "./reading";
import type {
  ReadingDocument,
  ReadingSelection,
  WordInfo,
  WordState,
} from "./types";

export const ROUND_SIZE = 20;
export type StudyState = "all" | "unmastered" | WordState;
export interface Occurrence {
  count: number;
  selection: ReadingSelection;
}
export interface StudyInventory {
  inputs: string[];
  occurrences: Map<string, Occurrence>;
}
// Forms of one word family listed under the base form (the surfaces seen).
export type StudyWord = WordInfo & Occurrence & { forms: string[] };

// Adapted from EnglishCD extension study-inventory/shared study-words. This is a
// complete local inventory, independent of the DOM highlighter's scan limits.
export function createInventory(document: ReadingDocument): StudyInventory {
  validateArticle(document.text);
  const occurrences = new Map<string, Occurrence>();
  let total = 0;
  for (const paragraph of document.text.matchAll(/[^\r\n]+/g)) {
    const text = paragraph[0];
    for (const token of wordsIn(text)) {
      if (++total > 100000)
        throw new Error("正文超过 100000 个词语位置，未返回不完整词表");
      const previous = occurrences.get(token.word);
      if (previous) {
        previous.count++;
        continue;
      }
      if (occurrences.size >= 5000)
        throw new Error("正文超过 5000 个不同词形，未返回不完整词表");
      if (utf8ByteLength(token.word) > 128)
        throw new Error("正文含超过 128 字节的词语，无法完整查询");
      occurrences.set(token.word, {
        count: 1,
        selection: {
          documentId: document.documentId,
          selectedText: text.slice(token.start, token.end),
          ...snapshotInText(text, token.start, token.end),
          kind: "word",
        },
      });
    }
  }
  if (!occurrences.size) throw new Error("正文中没有英语单词");
  return { inputs: [...occurrences.keys()], occurrences };
}

// A word family: forms with a single base form in the dictionary's form table
// share that base form's key and state (the server writes states there).
export function familyKey(info: WordInfo) {
  return info.lemmaCandidates?.length === 1
    ? info.lemmaCandidates[0]
    : info.termKey;
}

// Adapted from EnglishCD shared/study-words aggregateStudyWords: forms merge
// under the base form; non-dictionary words (names, brands, typos) are skipped.
export function mergeInventory(
  inventory: StudyInventory,
  infos: WordInfo[],
): StudyWord[] {
  const byInput = new Map(infos.map((info) => [info.input, info]));
  const result = new Map<string, StudyWord>();
  for (const input of inventory.inputs) {
    const info = byInput.get(input);
    const occurrence = inventory.occurrences.get(input)!;
    if (!info) throw new Error("词汇查询结果不完整，请手动重试");
    if (!dictionaryWord(info)) continue;
    const key = familyKey(info);
    const previous = result.get(key);
    if (previous) {
      previous.count += occurrence.count;
      if (!previous.forms.includes(info.termKey))
        previous.forms.push(info.termKey);
    } else
      result.set(key, {
        ...info,
        termKey: key,
        count: occurrence.count,
        selection: { ...occurrence.selection, termKey: key },
        forms: [info.termKey],
      });
  }
  return [...result.values()];
}

// ignored (暂不学习, e.g. names) is neither mastered nor still to learn; the
// personal vocabulary lists it, article counts leave it out.
export function isUnmastered(state: WordState) {
  return state === "unknown" || state === "learning";
}

export function studySummary(words: readonly WordInfo[]) {
  const total = words.filter((word) => word.state !== "ignored").length;
  const known = words.filter((word) => word.state === "known").length;
  return { total, known, unmastered: total - known };
}

export function wordTags(word: WordInfo) {
  return word.entry?.tags?.length
    ? [...new Set(word.entry.tags)]
    : ["ungraded"];
}
export function tagLabel(tag: string) {
  return tag === "ungraded"
    ? "未分级"
    : tag.toUpperCase().replace(/^CET([46])$/, "CET-$1");
}
export function filterWords(
  words: StudyWord[],
  state: StudyState,
  tag: string,
  query: string,
) {
  const search = query.trim().toLowerCase();
  return words.filter(
    (word) =>
      (state === "all" ||
        (state === "unmastered"
          ? isUnmastered(word.state)
          : word.state === state)) &&
      (!tag || wordTags(word).includes(tag)) &&
      (!search || word.termKey.toLowerCase().includes(search)),
  );
}
export function toggleSelection(
  selected: ReadonlySet<string>,
  terms: string[],
) {
  const next = new Set(selected);
  const remove = terms.length > 0 && terms.every((term) => next.has(term));
  for (const term of terms) {
    if (remove) next.delete(term);
    else next.add(term);
  }
  return next;
}
export function selectedWords(
  words: StudyWord[],
  selected: ReadonlySet<string>,
) {
  return words.filter((word) => selected.has(word.termKey));
}
export function advancePractice(position: number, length: number) {
  const next = Math.min(position + 1, length);
  return {
    position: next,
    roundComplete: next < length && next % ROUND_SIZE === 0,
  };
}
