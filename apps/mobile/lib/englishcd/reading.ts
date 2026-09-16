import type { ReadingSelection, WordInfo } from "./types";

// Adapted from EnglishCD shared/reading.ts. Surface extraction only: the server
// owns term keys, lemmas, dictionary tags and vocabulary state.
export type ReadingAction = "lookup" | "translate" | "capture";
export const MAX_READING_DOCUMENT_BYTES = 2 * 1024 * 1024;

export function utf8ByteLength(text: string) {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validateArticle(text: string) {
  if (!text.trim()) throw new Error("当前文章没有可用正文");
  if (utf8ByteLength(text) > MAX_READING_DOCUMENT_BYTES)
    throw new Error("正文超过 2 MiB，未截断，请选择较短文章");
}

export function wordsIn(text: string) {
  return [...text.matchAll(/[A-Za-z]+(?:['’ʼ-][A-Za-z]+)*/g)].map((match) => ({
    word: match[0],
    start: match.index!,
    end: match.index! + match[0].length,
  }));
}

export function highlightKind(info: WordInfo, tag = "") {
  if (info.state === "known" || info.state === "ignored") return null;
  if (tag && !info.entry?.tags?.includes(tag)) return null;
  return info.collected ? "collected" : "new";
}

export function snapshotInText(text: string, start: number, end: number) {
  const remaining = Math.max(0, 4000 - (end - start));
  let from = Math.max(0, start - Math.floor(remaining / 2));
  let to = Math.min(text.length, end + remaining - (start - from));
  // Keep UTF-16 offsets intact without cutting a surrogate pair at the edges.
  if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from++;
  if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
  const before = text.slice(from, start);
  const boundary = [...before.matchAll(/[.!?]\s+|\n/g)].at(-1);
  if (boundary) from += boundary.index! + boundary[0].length;
  const after = text.slice(end, to).match(/[.!?](?:\s|$)|\n/);
  if (after?.index !== undefined) to = end + after.index + after[0].length;
  const fallback = {
    contextText: text.slice(from, to),
    selection: { start: start - from, end: end - from },
  };
  if (typeof Intl.Segmenter !== "function" || text.length > 20000)
    return fallback;
  from = -1;
  for (const segment of new Intl.Segmenter("en", {
    granularity: "sentence",
  }).segment(text)) {
    const next = segment.index + segment.segment.length;
    if (segment.index <= start && start < next) from = segment.index;
    if (segment.index < end && end <= next) {
      if (from < 0 || next - from > 4000) return fallback;
      return {
        contextText: text.slice(from, next),
        selection: { start: start - from, end: end - from },
      };
    }
  }
  return fallback;
}

export function readingSelection(
  documentId: string,
  text: string,
  start: number,
  end: number,
): ReadingSelection | null {
  const selectedText = text.slice(start, end);
  if (
    !documentId ||
    start < 0 ||
    end > text.length ||
    start >= end ||
    selectedText.length > 4000 ||
    !selectedText.trim()
  )
    return null;
  const tokens = wordsIn(selectedText.trim());
  const kind =
    tokens.length === 1 && tokens[0].word === selectedText.trim()
      ? "word"
      : tokens.length > 1 && /^[A-Za-z'’ʼ\s-]+$/.test(selectedText.trim())
        ? "phrase"
        : "sentence";
  return {
    documentId,
    selectedText,
    ...snapshotInText(text, start, end),
    kind,
  };
}

export interface ReadingPress {
  id: number;
  x: number;
  y: number;
  started: number;
  cancelled: boolean;
}

// A long press can synthesize a click. Never reinterpret it as a word tap.
export function isReadingTap(
  press: ReadingPress | null,
  event: {
    timeStamp: number;
    clientX: number;
    clientY: number;
    button: number;
  },
) {
  return (
    !!press &&
    !press.cancelled &&
    event.button === 0 &&
    event.timeStamp - press.started <= 400 &&
    Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 10
  );
}
