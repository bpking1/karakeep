import {
  MAX_READING_DOCUMENT_BYTES,
  readingSelection,
  utf8ByteLength,
} from "./reading";

// Readable DOM snapshots are separate from asynchronous decoration and gestures.
const SKIP =
  "script,style,noscript,template,input,textarea,select,button,[contenteditable],svg,math,[hidden],[aria-hidden=true]";
const BLOCK = "p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,div,article";
interface TextPart {
  node: Text;
  start: number;
  end: number;
}
export interface TextRun {
  block: Element;
  text: string;
  parts: TextPart[];
}

function readable(parent: Element, root: HTMLElement, includeCode = false) {
  if (parent.closest(SKIP) || (!includeCode && parent.closest("pre,code")))
    return false;
  for (
    let element: Element | null = parent;
    element;
    element = element.parentElement
  ) {
    const style = root.ownerDocument.defaultView!.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return false;
    if (element === root) break;
  }
  return true;
}

export function collectReadingRuns(
  root: HTMLElement,
  includeCode = false,
): TextRun[] {
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4);
  const runs: TextRun[] = [];
  let current: TextRun | undefined;
  let node: Node | null;
  let visited = 0;
  let bytes = 0;
  while ((node = walker.nextNode())) {
    if (++visited > 200000)
      throw new Error("正文结构过大，无法建立完整学习快照。");
    if (node.nodeType === 1) {
      if ((node as Element).tagName === "BR") current = undefined;
      continue;
    }
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || !readable(parent, root, includeCode)) {
      current = undefined;
      continue;
    }
    const block = parent.closest(BLOCK) ?? root;
    if (!current || current.block !== block) {
      current = { block, text: "", parts: [] };
      if (runs.length) bytes += 2;
      runs.push(current);
    }
    bytes += utf8ByteLength(textNode.data);
    if (bytes > MAX_READING_DOCUMENT_BYTES)
      throw new Error("正文超过 2 MiB，无法建立完整学习快照。");
    current.parts.push({
      node: textNode,
      start: current.text.length,
      end: current.text.length + textNode.length,
    });
    current.text += textNode.data;
  }
  return runs;
}

export function rangeInRun(
  root: HTMLElement,
  run: TextRun,
  start: number,
  end: number,
) {
  const first = run.parts.find(
    (part) => part.start <= start && start < part.end,
  );
  const last = run.parts.find((part) => part.start < end && end <= part.end);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

export function rangeAtOffsets(root: HTMLElement, start: number, end: number) {
  if (start < 0 || end <= start) return null;
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const range = root.ownerDocument.createRange();
  let offset = 0;
  let started = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const next = offset + (node.textContent?.length ?? 0);
    if (!started && start < next) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}

export function selectionInRange(
  root: HTMLElement,
  range: Range,
  documentId: string,
) {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const text = range.toString();
  if (!text.trim() || text.length > 4000) return null;
  const all = root.ownerDocument.createTreeWalker(root, 4);
  const selectedNodes: Text[] = [];
  let node: Node | null;
  while ((node = all.nextNode())) {
    if (
      !range.intersectsNode(node) ||
      !node.textContent ||
      (node === range.startContainer &&
        range.startOffset === node.textContent.length) ||
      (node === range.endContainer && range.endOffset === 0)
    )
      continue;
    if (!node.parentElement || !readable(node.parentElement, root, true))
      return null;
    selectedNodes.push(node as Text);
  }
  if (!selectedNodes.length) return null;
  const fallback = readingSelection(documentId, text, 0, text.length);
  const runs = collectReadingRuns(root, true);
  for (const run of runs) {
    if (
      !selectedNodes.every((selected) =>
        run.parts.some((part) => part.node === selected),
      )
    )
      continue;
    const first = run.parts.find((part) => part.node === selectedNodes[0])!;
    const last = run.parts.find((part) => part.node === selectedNodes.at(-1))!;
    const start =
      first.start +
      (range.startContainer === first.node ? range.startOffset : 0);
    const end =
      last.start +
      (range.endContainer === last.node ? range.endOffset : last.node.length);
    if (run.text.slice(start, end) === text)
      return readingSelection(documentId, run.text, start, end);
  }
  return fallback ? { ...fallback, kind: "sentence" as const } : null;
}
