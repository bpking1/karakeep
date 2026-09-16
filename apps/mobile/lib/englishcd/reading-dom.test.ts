import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import type { Range as TestRange } from "happy-dom";
import type { ReadingDOMOptions } from "./reading-dom";
import { createReadingController } from "./reading-dom";
import {
  collectReadingRuns,
  rangeAtOffsets,
  selectionInRange,
} from "./reading-dom-text";
import type { WordInfo } from "./types";

class TestHighlight {
  ranges: Range[] = [];
  add(range: Range) {
    this.ranges.push(range);
  }
}

function fixture(html: string, supported = true) {
  const window = new Window();
  const registry = new Map<string, TestHighlight>();
  if (supported) {
    Object.defineProperty(window, "Highlight", { value: TestHighlight });
    Object.defineProperty(window, "CSS", { value: { highlights: registry } });
  }
  const root = window.document.createElement("article");
  root.innerHTML = html;
  window.document.body.append(root);
  const errors: string[] = [];
  const documents: { documentId: string; text: string }[] = [];
  const batches: string[][] = [];
  const options: ReadingDOMOptions = {
    documentId: "first",
    tag: "",
    lookup: async (words) => {
      batches.push(words);
      return words.map((input) => ({
        input,
        termKey: input.toLowerCase(),
        state: "unknown",
        collected: false,
      }));
    },
    phrases: async () => [],
    open: async () => undefined,
    document: async (value) => {
      documents.push(value);
    },
    error: async (value) => {
      errors.push(value);
    },
  };
  return {
    window,
    root: root as unknown as HTMLElement,
    registry,
    errors,
    documents,
    batches,
    options,
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("full readable text includes inline nodes and excludes hidden/script/code runs", () => {
  const { root } = fixture(
    '<p>Look <em>up</em> here.</p><p hidden>secret</p><p>Other<script>token</script> words.</p><code>password</code><div style="display:none"><p>hidden descendant</p></div>',
  );
  assert.equal(
    collectReadingRuns(root)
      .map((run) => run.text)
      .join("\n\n"),
    "Look up here.\n\nOther\n\n words.",
  );
});

test("decoration never changes HTML/text and saved phrases cross inline markup only", async () => {
  const item = fixture("<p>Look <em>up</em> now.</p><p>look</p><p>up</p>");
  const html = item.root.innerHTML;
  const controller = createReadingController(item.root, {
    ...item.options,
    phrases: async () => [{ termKey: "look up", state: "unknown" }],
  });
  await tick();
  assert.equal(item.root.innerHTML, html);
  assert.equal(item.registry.get("englishcd-collected")?.ranges.length, 1);
  assert.equal(
    item.registry.get("englishcd-collected")?.ranges[0].toString(),
    "Look up",
  );
  assert.equal(item.documents[0].text, "Look up now.\n\nlook\n\nup");
  controller.dispose();
  assert.equal(item.registry.size, 0);
});

test("manual annotations keep their styling and rebuilt nodes get fresh ranges", async () => {
  const item = fixture(
    '<p><span data-highlight="true">First</span> second.</p>',
  );
  const controller = createReadingController(item.root, item.options);
  await tick();
  assert.deepEqual(
    item.registry.get("englishcd-new")!.ranges.map((range) => range.toString()),
    ["second"],
  );
  const firstRange = item.registry.get("englishcd-new")!.ranges[0];
  item.root.innerHTML =
    '<p><span data-highlight="true">First</span> <span>second.</span></p>';
  controller.rebuild();
  assert.equal(
    item.registry.get("englishcd-new")!.ranges[0].toString(),
    "second",
  );
  assert.notEqual(
    item.registry.get("englishcd-new")!.ranges[0].startContainer,
    firstRange.startContainer,
  );
  assert.equal(item.batches.length, 1);
  controller.dispose();
});

test("selection snapshots handle inline markup, UTF-16, and reject hidden context", () => {
  const { root } = fixture(
    "<p>😀 Read <em>these words</em> today.</p><p hidden>secret</p>",
  );
  const start = root.textContent!.indexOf("these");
  const range = rangeAtOffsets(root, start, start + 11)!;
  const selection = selectionInRange(root, range, "one")!;
  assert.equal(selection.selectedText, "these words");
  assert.equal(selection.contextText, "😀 Read these words today.");
  assert.equal(
    selection.contextText.slice(
      selection.selection.start,
      selection.selection.end,
    ),
    "these words",
  );
  assert.equal(
    selectionInRange(
      root,
      rangeAtOffsets(root, 0, root.textContent!.length)!,
      "one",
    ),
    null,
  );
});

test("unsupported WebView still publishes complete document without a lookup", async () => {
  const item = fixture("<p>Full text.</p>", false);
  const controller = createReadingController(item.root, item.options);
  await tick();
  assert.equal(item.documents[0].text, "Full text.");
  assert.equal(item.batches.length, 0);
  assert.match(item.errors[0], /不支持生词高亮/);
  controller.dispose();
});

test("document and import snapshot retain visible code while highlights skip it", async () => {
  const item = fixture("<p>Use <code>const value = 1;</code> here.</p>");
  const controller = createReadingController(item.root, item.options);
  await tick();
  assert.equal(item.documents[0].text, "Use const value = 1; here.");
  assert.deepEqual(item.batches.flat(), ["Use", "here"]);
  const start = item.root.textContent!.indexOf("const");
  const value = selectionInRange(
    item.root,
    rangeAtOffsets(item.root, start, start + 5)!,
    "one",
  );
  assert.equal(value?.selectedText, "const");
  controller.dispose();
});

test("batches never exceed 500 words and lookup failure does not prevent document delivery", async () => {
  const inputs = Array.from({ length: 1100 }, (_, index) =>
    String.fromCharCode(
      97 + Math.floor(index / 676),
      97 + (Math.floor(index / 26) % 26),
      97 + (index % 26),
    ),
  );
  const item = fixture(`<p>${inputs.join(" ")}</p>`);
  const controller = createReadingController(item.root, item.options);
  await tick();
  assert.deepEqual(
    item.batches.map((batch) => batch.length),
    [500, 500, 100],
  );
  controller.dispose();
  const failure = fixture("<p>Still readable.</p>");
  const failed = createReadingController(failure.root, {
    ...failure.options,
    lookup: async () => {
      throw new Error("network unavailable");
    },
  });
  await tick();
  assert.equal(failure.documents[0].text, "Still readable.");
  assert.match(failure.errors[0], /生词状态暂时不可用/);
  assert.match(failure.errors[0], /network unavailable/);
  failed.dispose();
});

test("disposed generation cannot paint late lookup results or clear a newer reader", async () => {
  const item = fixture("<p>Original words.</p>");
  let resolve!: (words: WordInfo[]) => void;
  const pending = new Promise<WordInfo[]>((done) => {
    resolve = done;
  });
  const old = createReadingController(item.root, {
    ...item.options,
    lookup: async () => pending,
  });
  old.dispose();
  const current = createReadingController(item.root, {
    ...item.options,
    documentId: "second",
  });
  await tick();
  resolve([
    {
      input: "Original",
      termKey: "original",
      collected: true,
      state: "unknown",
    },
  ]);
  await tick();
  old.dispose();
  assert.equal(item.registry.get("englishcd-collected")!.ranges.length, 0);
  assert.equal(item.registry.get("englishcd-new")!.ranges.length, 2);
  current.dispose();
});

test("glyph taps open one card, while links, manual annotations and active selections win", async () => {
  const item = fixture(
    '<p>Word <a href="https://example.invalid">link</a><span data-highlight="true">note</span></p>',
  );
  const opened: string[] = [];
  const controller = createReadingController(item.root, {
    ...item.options,
    open: async (value) => {
      opened.push(value.selectedText);
    },
  });
  await tick();
  const range = item.registry.get("englishcd-new")!.ranges[0];
  Object.defineProperty(range, "getClientRects", {
    value: () => [{ left: 0, right: 100, top: 0, bottom: 30 }],
  });
  Object.defineProperty(item.window.document, "caretRangeFromPoint", {
    value: () => range,
  });
  const tap = (target: Element) => {
    const down = new item.window.PointerEvent("pointerdown", {
      bubbles: true,
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    const click = new item.window.MouseEvent("click", {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(down, "timeStamp", { value: 100 });
    Object.defineProperty(click, "timeStamp", { value: 200 });
    Object.defineProperty(click, "isTrusted", { value: true });
    target.dispatchEvent(down as unknown as Event);
    target.dispatchEvent(click as unknown as Event);
  };
  tap(item.root.querySelector("p")!);
  tap(item.root.querySelector("a")!);
  tap(item.root.querySelector("span")!);
  item.window.getSelection()!.addRange(range as unknown as TestRange);
  tap(item.root.querySelector("p")!);
  assert.deepEqual(opened, ["Word"]);
  controller.dispose();
});

test("oversized document explicitly fails without publishing a partial snapshot", () => {
  const item = fixture(`<p>${"x".repeat(2 * 1024 * 1024 + 1)}</p>`);
  const controller = createReadingController(item.root, item.options);
  assert.equal(item.documents.length, 0);
  assert.match(item.errors[0], /2 MiB/);
  controller.dispose();
});
