import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

async function fixture() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const clients = [],
    mounts = [],
    focusListeners = new Set();
  let focused = true,
    settingsLoading = false,
    latest;
  const settings = {
    enabled: true,
    url: "http://home:8787",
    apiKey: "test",
    tag: "",
  };
  class Client {
    closed = false;
    invalidations = 0;
    constructor() {
      clients.push(this);
    }
    close() {
      this.closed = true;
    }
    invalidate() {
      assert.equal(this.closed, false);
      this.invalidations++;
    }
    lookup(words) {
      assert.equal(this.closed, false);
      return Promise.resolve(
        words.map((input) => ({ input, termKey: input, state: "unknown" })),
      );
    }
  }
  const overrides = {
    "react-native": {
      AppState: {
        addEventListener: () => ({
          remove() {
            /* No native listener in this fixture. */
          },
        }),
      },
    },
    "expo-router": {
      useFocusEffect: (callback) => {
        const active = React.useSyncExternalStore(
          (listener) => {
            focusListeners.add(listener);
            return () => focusListeners.delete(listener);
          },
          () => focused,
        );
        React.useEffect(
          () => (active ? callback() : undefined),
          [active, callback],
        );
      },
    },
    "@/lib/englishcd/settings": {
      useEnglishCDSettings: () => ({ settings, isLoading: settingsLoading }),
    },
    "@/lib/englishcd/client": { EnglishCDClient: Client },
    "@/lib/englishcd/word-card": { selectionError: () => "" },
    "@/components/englishcd/WordCard": { default: () => null },
    "@/components/englishcd/StudyPanel": { StudyPanel: () => null },
    "@/components/englishcd/ImportPanel": { ImportPanel: () => null },
  };
  const module = { exports: {} };
  const filename = new URL(
    "../../components/englishcd/ReaderSession.tsx",
    import.meta.url,
  );
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (name) => overrides[name] ?? require(name),
    },
    { filename: filename.pathname },
  );
  const { EnglishCDReaderSession, useEnglishCDReader } = module.exports;
  // Models Expo's fixed initialProps: updates cannot repair a false initial
  // enabled flag while the WebView has not installed its props listener yet.
  function CachedDOM({ reader }) {
    const [initial] = React.useState(() => ({
      enabled: reader.enabled,
      documentId: reader.documentId,
    }));
    React.useEffect(() => {
      mounts.push(initial);
    }, [initial]);
    return null;
  }
  function Reader() {
    const reader = useEnglishCDReader();
    latest = reader;
    return reader.initializing
      ? null
      : React.createElement(CachedDOM, { reader });
  }
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const render = async (id = "a", supported = true) => {
    await act(async () =>
      root.render(
        id
          ? React.createElement(
              EnglishCDReaderSession,
              {
                key: id,
                documentId: id,
                title: id,
                supported,
                source: { kind: "karakeep", title: id },
              },
              React.createElement(Reader),
            )
          : null,
      ),
    );
  };
  return {
    clients,
    mounts,
    render,
    settings,
    latest: () => latest,
    loading: (value) => {
      settingsLoading = value;
    },
    focus: async (value) =>
      act(async () => {
        focused = value;
        for (const listener of focusListeners) listener();
      }),
    close: async () => {
      await act(async () => root.unmount());
      await window.happyDOM.close();
    },
  };
}

test("cached articles and repeat opens mount DOM only with a ready EnglishCD connection", async () => {
  const f = await fixture();
  try {
    for (const id of ["a", "a", "b", "b"]) {
      await f.render(id);
      assert.equal(f.latest().initializing, false);
      assert.equal(f.latest().enabled, true);
      assert.equal((await f.latest().lookup(["word"]))[0].termKey, "word");
      await f.render(null);
      assert.equal(f.clients.at(-1).closed, true);
    }
    assert.deepEqual(
      f.mounts,
      ["a", "a", "b", "b"].map((documentId) => ({ enabled: true, documentId })),
    );
    const preview = source(
      "../../components/bookmarks/BookmarkLinkPreview.tsx",
    );
    assert.match(
      preview,
      /if \(!displayedBookmarkWithContent \|\| englishCD\?\.initializing\)/,
    );
  } finally {
    await f.close();
  }
});

test("returning to a retained reading screen invalidates words and rebuilds highlights without replacing the client", async () => {
  const f = await fixture();
  try {
    await f.render();
    const client = f.clients[0],
      revision = f.latest().revision,
      invalidations = client.invalidations;
    await f.focus(false);
    assert.equal(f.latest().revision, revision);
    await f.focus(true);
    assert.equal(f.clients.length, 1);
    assert.equal(client.invalidations, invalidations + 1);
    assert.equal(f.latest().revision, revision + 1);
  } finally {
    await f.close();
  }
});

test("settings hydration waits, while disabled or unsupported learning never blocks ordinary reading", async () => {
  const f = await fixture();
  try {
    f.loading(true);
    await f.render();
    assert.equal(f.mounts.length, 0);
    f.loading(false);
    await f.render();
    assert.equal(f.mounts[0].enabled, true);
    await f.render(null);
    f.settings.enabled = false;
    await f.render("b");
    assert.equal(f.latest().initializing, false);
    assert.equal(f.mounts.at(-1).enabled, false);
    await f.render(null);
    f.settings.enabled = true;
    f.loading(true);
    await f.render("c", false);
    assert.equal(f.latest().initializing, false);
    assert.equal(f.clients.length, 1);
  } finally {
    await f.close();
  }
});

test("study filters live in the scrollable list header and cannot shrink vertically", () => {
  const panel = source("../../components/englishcd/StudyPanel.tsx");
  const ast = ts.createSourceFile(
    "StudyPanel.tsx",
    panel,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const tags = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      tags.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const list = tags.find((node) => node.tagName.getText(ast) === "FlatList");
  const header = list.attributes.properties.find(
    (attr) => attr.name?.getText(ast) === "ListHeaderComponent",
  );
  assert.ok(header);
  const headerText = header.getText(ast);
  assert.equal(
    (headerText.match(/flexGrow: 0, flexShrink: 0/g) || []).length,
    2,
  );
  assert.match(headerText, /placeholder="搜索词语"/);
  assert.match(list.getText(ast), /flex: 1, minHeight: 0/);
  assert.match(
    panel,
    /LearningModal title="本文词汇学习" onClose=\{onClose\} fill/,
  );
});
