import type { TextRun } from "./reading-dom-text";
import { collectReadingRuns, rangeInRun } from "./reading-dom-text";
import type { CollectedPhrase, ReadingSelection, WordInfo } from "./types";
import type { ReadingAction, ReadingPress } from "./reading";
import { phraseMatcher } from "./phrases";
import {
  highlightKind,
  isReadingTap,
  readingSelection,
  utf8ByteLength,
  wordsIn,
} from "./reading";

// DOM-only port of MiniReader's englishcd-reader.js. No network, credentials,
// source identity or persistent state crosses into this module.
const MAX_HIGHLIGHT_WORDS = 20000;
interface Hit {
  range: Range;
  run: TextRun;
  start: number;
  end: number;
  termKey?: string;
  kind: "word" | "phrase";
}
interface HighlightSet {
  add(range: Range): void;
}
interface HighlightAPI {
  Highlight: new () => HighlightSet;
  CSS: {
    highlights: {
      set(name: string, value: HighlightSet): void;
      delete(name: string): void;
    };
  };
}

export interface ReadingDOMOptions {
  documentId: string;
  tag: string;
  lookup: (words: string[]) => Promise<WordInfo[]>;
  phrases: () => Promise<CollectedPhrase[]>;
  open: (selection: ReadingSelection, action: ReadingAction) => Promise<void>;
  document: (value: { documentId: string; text: string }) => Promise<void>;
  error: (message: string) => Promise<void>;
}

export function createReadingController(
  root: HTMLElement,
  options: ReadingDOMOptions,
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const api = win as unknown as Partial<HighlightAPI>;
  let disposed = false;
  let runs: TextRun[] = [];
  let originalText = "";
  let savedPhrases: CollectedPhrase[] = [];
  const info = new Map<string, WordInfo>();
  let hits = new Map<Node, Hit[]>();
  let press: ReadingPress | null = null;
  const style = doc.createElement("style");
  style.textContent =
    "::highlight(englishcd-new){background-color:#f9d97866;text-decoration:underline #aa8528}::highlight(englishcd-collected){background-color:#86cabd66;text-decoration:underline #388578}";
  doc.head.append(style);
  const report = (message: string) => {
    if (!disposed) void options.error(message).catch(() => undefined);
  };
  const supportsHighlights = !!api.Highlight && !!api.CSS?.highlights;

  function draw() {
    hits = new Map();
    if (disposed || !supportsHighlights) return;
    const fresh = new api.Highlight!();
    const collected = new api.Highlight!();
    const match = phraseMatcher(savedPhrases);
    let scanned = 0;
    for (const run of runs) {
      for (const token of match(run.text)) {
        if (++scanned > MAX_HIGHLIGHT_WORDS) break;
        const word = token.phrase ? undefined : info.get(token.word);
        const kind = token.phrase
          ? "collected"
          : word && highlightKind(word, options.tag);
        if (!kind) continue;
        const parts = run.parts.filter(
          (part) => part.start < token.end && part.end > token.start,
        );
        // Manual annotations own their visual treatment and tap action.
        if (
          parts.some((part) =>
            part.node.parentElement?.closest("[data-highlight]"),
          )
        )
          continue;
        const range = rangeInRun(root, run, token.start, token.end);
        if (!range) continue;
        (kind === "collected" ? collected : fresh).add(range);
        for (const part of parts) {
          const list = hits.get(part.node) ?? [];
          list.push({
            range,
            run,
            start: token.start,
            end: token.end,
            termKey: token.phrase ?? word?.termKey,
            kind: token.phrase ? "phrase" : "word",
          });
          hits.set(part.node, list);
        }
      }
      if (scanned > MAX_HIGHLIGHT_WORDS) break;
    }
    api.CSS!.highlights.set("englishcd-new", fresh);
    api.CSS!.highlights.set("englishcd-collected", collected);
  }

  function rebuild() {
    if (disposed) return;
    try {
      const next = collectReadingRuns(root);
      if (
        collectReadingRuns(root, true)
          .map((run) => run.text)
          .join("\n\n") !== originalText
      ) {
        dispose();
        return;
      }
      runs = next;
      draw();
    } catch {
      dispose();
    }
  }

  function pointerDown(event: PointerEvent) {
    press =
      event.isPrimary && event.button === 0
        ? {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            started: event.timeStamp,
            cancelled: false,
          }
        : null;
  }
  function pointerMove(event: PointerEvent) {
    if (
      press?.id === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
    )
      press.cancelled = true;
  }
  function cancelPress() {
    if (press) press.cancelled = true;
  }
  function click(event: MouseEvent) {
    const current = press;
    press = null;
    const target = event.target as Element | null;
    if (
      disposed ||
      !event.isTrusted ||
      !isReadingTap(current, event) ||
      target?.nodeType !== 1 ||
      target.closest("a,button,input,textarea,[data-highlight]") ||
      !win.getSelection()?.isCollapsed
    )
      return;
    const caretDoc = doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    const caret = caretDoc.caretRangeFromPoint?.(event.clientX, event.clientY);
    const point = !caret
      ? caretDoc.caretPositionFromPoint?.(event.clientX, event.clientY)
      : null;
    const node = caret?.startContainer ?? point?.offsetNode;
    if (!node) return;
    for (const hit of hits.get(node) ?? []) {
      if (
        Array.from(hit.range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        )
      ) {
        const value = readingSelection(
          options.documentId,
          hit.run.text,
          hit.start,
          hit.end,
        );
        if (value)
          void options
            .open({ ...value, termKey: hit.termKey, kind: hit.kind }, "lookup")
            .catch(() => report("无法打开 EnglishCD 词卡。"));
        return;
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeEventListener("pointerdown", pointerDown);
    root.removeEventListener("pointermove", pointerMove);
    root.removeEventListener("pointercancel", cancelPress);
    root.removeEventListener("contextmenu", cancelPress);
    root.removeEventListener("click", click);
    win.removeEventListener("scroll", cancelPress, true);
    style.remove();
    api.CSS?.highlights?.delete("englishcd-new");
    api.CSS?.highlights?.delete("englishcd-collected");
    info.clear();
    hits.clear();
  }

  async function load(words: string[]) {
    const phraseRequest = options
      .phrases()
      .then((values) => {
        if (!disposed) {
          savedPhrases = values;
          draw();
        }
      })
      .catch((error: unknown) =>
        report(`EnglishCD 收藏短语暂时不可用：${errorDetail(error)}`),
      );
    try {
      for (let start = 0; start < words.length; start += 500) {
        const values = await options.lookup(words.slice(start, start + 500));
        if (disposed) return;
        for (const value of values) info.set(value.input, value);
        draw();
      }
    } catch (error) {
      report(`EnglishCD 生词状态暂时不可用：${errorDetail(error)}`);
    }
    await phraseRequest;
  }

  try {
    runs = collectReadingRuns(root);
    originalText = collectReadingRuns(root, true)
      .map((run) => run.text)
      .join("\n\n");
    void options
      .document({ documentId: options.documentId, text: originalText })
      .catch(() => report("无法建立本文学习快照。"));
    if (!supportsHighlights)
      report(
        "当前 WebView 不支持生词高亮；仍可使用选区操作、本文词汇和导入英语。",
      );
    else {
      const words = new Set<string>();
      let scanned = 0;
      for (const run of runs) {
        for (const token of wordsIn(run.text)) {
          if (++scanned > MAX_HIGHLIGHT_WORDS) break;
          if (utf8ByteLength(token.word) <= 128) words.add(token.word);
        }
        if (scanned > MAX_HIGHLIGHT_WORDS) break;
      }
      if (scanned > MAX_HIGHLIGHT_WORDS)
        report("长文仅高亮前 20000 个词；本文词汇和导入仍使用完整正文。");
      void load([...words]);
    }
  } catch (error) {
    report(error instanceof Error ? error.message : "无法读取学习正文。");
  }
  root.addEventListener("pointerdown", pointerDown, { passive: true });
  root.addEventListener("pointermove", pointerMove, { passive: true });
  root.addEventListener("pointercancel", cancelPress, { passive: true });
  root.addEventListener("contextmenu", cancelPress, { passive: true });
  root.addEventListener("click", click);
  win.addEventListener("scroll", cancelPress, { passive: true, capture: true });
  return { dispose, rebuild };
}

function errorDetail(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "请求失败，请检查连接。";
}
