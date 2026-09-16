import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const filename = new URL(
  "../../../../packages/shared-react/components/BookmarkHtmlHighlighter.tsx",
  import.meta.url,
);

// Exercise the actual shared component with React 19, replacing only visual
// controls. No Radix positioning, Expo runtime, browser or backend is launched.
function loadHighlighter(window) {
  const container = ({ children }) =>
    React.createElement("div", null, children);
  const controls = {
    "@/lib/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@radix-ui/react-popover": { PopoverAnchor: container },
    "lucide-react": { Check: () => null, Trash2: () => null },
    "@karakeep/shared/types/highlights": {
      SUPPORTED_HIGHLIGHT_COLORS: ["yellow", "blue"],
    },
    "./highlights": {
      HIGHLIGHT_COLOR_MAP: { bg: { yellow: "bg-yellow", blue: "bg-blue" } },
    },
    "./ui/button": {
      Button: ({ children, onClick }) =>
        React.createElement("button", { onClick }, children),
    },
    "./ui/textarea": {
      Textarea: ({ value, onChange }) =>
        React.createElement("textarea", { value, onChange }),
    },
    "./ui/popover": {
      Popover: ({ open, children }) =>
        open ? React.createElement("div", null, children) : null,
      PopoverContent: container,
    },
  };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (name) => controls[name] ?? require(name),
      window,
      document: window.document,
      NodeFilter: window.NodeFilter,
      setTimeout,
      clearTimeout,
    },
    { filename: filename.pathname },
  );
  return module.exports.default;
}

async function fixture() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const Component = loadHighlighter(window);
  const ref = createRef();
  const listeners = [];
  const add = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (name, ...args) => {
    listeners.push(name);
    return add(name, ...args);
  };
  const highlights = [
    {
      id: "saved",
      startOffset: 0,
      endOffset: 4,
      text: "Read",
      color: "yellow",
      note: "Existing note",
    },
  ];
  const props = {
    ref,
    htmlContent: "<p>Read <em>these words</em> today.</p>",
    highlights,
  };
  const render = async (next = {}) => {
    await act(async () =>
      root.render(React.createElement(Component, { ...props, ...next })),
    );
  };
  await render();
  return {
    window,
    host,
    ref,
    props,
    listeners,
    render,
    cleanup: async () => {
      await act(async () => root.unmount());
    },
  };
}

test("Web usage adds no learning listener or menu and opening an annotation preserves its DOM", async () => {
  const item = await fixture();
  try {
    assert.equal(item.listeners.includes("selectionchange"), false);
    const span = item.ref.current.querySelector("[data-highlight]");
    const paragraph = item.ref.current.firstChild;
    await act(async () =>
      span.dispatchEvent(
        new item.window.PointerEvent("pointerup", { bubbles: true }),
      ),
    );
    assert.equal(item.ref.current.firstChild, paragraph);
    assert.equal(item.ref.current.querySelector("[data-highlight]"), span);
    assert.equal(item.host.querySelector("textarea").value, "Existing note");
    assert.equal(
      item.host.querySelector('[aria-label="Selection actions"]'),
      null,
    );
    await item.render({ className: "changed", style: { fontSize: "18px" } });
    assert.equal(item.ref.current.firstChild, paragraph);
    assert.equal(item.ref.current.querySelector("[data-highlight]"), span);
  } finally {
    await item.cleanup();
  }
});

test("opening the selection form keeps native selection/copy and a server highlight refresh restores it", async () => {
  const item = await fixture();
  try {
    const em = item.ref.current.querySelector("em");
    const text = em.firstChild;
    const range = item.window.document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 11);
    item.window.getSelection().addRange(range);
    await act(async () =>
      em.dispatchEvent(
        new item.window.PointerEvent("pointerup", { bubbles: true }),
      ),
    );
    assert.equal(item.ref.current.querySelector("em").firstChild, text);
    assert.equal(item.window.getSelection().toString(), "these words");
    const copy = new item.window.Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    assert.equal(em.dispatchEvent(copy), true);
    assert.equal(copy.defaultPrevented, false);
    await item.render({
      highlights: [
        ...item.props.highlights,
        {
          id: "next",
          startOffset: 5,
          endOffset: 10,
          text: "these",
          color: "blue",
        },
      ],
    });
    assert.equal(item.window.getSelection().toString(), "these words");
    assert.equal(
      item.ref.current.querySelectorAll("[data-highlight]").length,
      2,
    );
    await item.render({
      htmlContent: "<p>Another article.</p>",
      highlights: [],
    });
    assert.equal(item.host.querySelector("textarea"), null);
  } finally {
    await item.cleanup();
  }
});

test("repeated native selection notifications do not discard an unsaved annotation color", async () => {
  const item = await fixture();
  try {
    const saved = [];
    await item.render({
      selectionActions: [{ id: "lookup", label: "Lookup" }],
      onHighlight: (value) => saved.push(value),
    });
    const em = item.ref.current.querySelector("em");
    const range = item.window.document.createRange();
    range.selectNodeContents(em);
    item.window.getSelection().addRange(range);
    await act(async () =>
      em.dispatchEvent(
        new item.window.PointerEvent("pointerup", { bubbles: true }),
      ),
    );
    const colors = [...item.host.querySelectorAll("button")].filter(
      (button) => !button.textContent.trim(),
    );
    await act(async () =>
      colors[1].dispatchEvent(
        new item.window.MouseEvent("click", { bubbles: true }),
      ),
    );
    await act(async () => {
      item.window.document.dispatchEvent(
        new item.window.Event("selectionchange"),
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const save = [...item.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    await act(async () =>
      save.dispatchEvent(
        new item.window.MouseEvent("click", { bubbles: true }),
      ),
    );
    assert.equal(saved[0].color, "blue");
  } finally {
    await item.cleanup();
  }
});
