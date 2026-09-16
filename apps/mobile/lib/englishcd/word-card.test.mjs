import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const load = createRequire(import.meta.url);
const { WordCardSession, selectionError } = load("./word-card.ts");

const selection = {
  documentId: "bookmark-1",
  selectedText: "books",
  contextText: "These books are useful.",
  selection: { start: 6, end: 11 },
  kind: "word",
  termKey: "book",
};
const source = {
  kind: "karakeep",
  externalId: "bookmark-1",
  title: "Books",
  url: "https://example.com/books",
};
const word = {
  input: "books",
  termKey: "book",
  state: "unknown",
  collected: false,
};
const saved = {
  termKey: "books",
  text: "书籍",
  targetLanguage: "zh-CN",
  updatedAt: "2026-09-16",
};
const generated = { text: "书；书籍", targetLanguage: "zh-CN" };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(overrides = {}, action = "lookup", input = selection) {
  const calls = {
    record: [],
    translate: [],
    visit: [],
    state: [],
    capture: [],
    changed: 0,
  };
  const api = {
    lookup: async () => [word],
    capabilities: async () => ({ translation: { enabled: true } }),
    record: async (...args) => {
      calls.record.push(args);
      return { record: saved };
    },
    translate: async (...args) => {
      calls.translate.push(args);
      return generated;
    },
    visit: async (...args) => {
      calls.visit.push(args);
    },
    setState: async (...args) => {
      calls.state.push(args);
    },
    capture: async (...args) => {
      calls.capture.push(args);
    },
    ...overrides,
  };
  let counter = 0;
  const session = new WordCardSession(
    api,
    input,
    source,
    action,
    () => calls.changed++,
    () => `test-key-${++counter}`,
  );
  return { session, calls, api };
}

test("saved lookup uses surface record, reports one explicit visit, and does not invoke AI", async () => {
  const { session, calls } = fixture();
  await session.initialize();
  await session.initialize();
  assert.deepEqual(calls.record, [["books"]]);
  assert.equal(calls.visit.length, 1);
  assert.equal(calls.translate.length, 0);
  assert.equal(session.snapshot().result.text, "书籍");
  assert.equal(session.snapshot().cached, true);
});

test("confirmed cache miss starts one context-aware lookup when AI is enabled", async () => {
  const { session, calls } = fixture({
    record: async () => ({ record: null }),
  });
  await session.initialize();
  await session.initialize();
  assert.deepEqual(calls.translate, [
    ["books", "These books are useful.", "dictionary"],
  ]);
  assert.equal(session.snapshot().aiBusy, false);
});

test("record read failure and malformed response cannot be treated as absence", async () => {
  for (const record of [
    async () => {
      throw new Error("database unavailable");
    },
    async () => ({}),
  ]) {
    const { session, calls } = fixture({ record });
    await session.initialize();
    await session.generate();
    assert.equal(calls.translate.length, 0);
    assert.equal(session.snapshot().recordReady, false);
    assert.ok(session.snapshot().recordError);
  }
});

test("manual read retry does not silently start a paid request", async () => {
  let reads = 0;
  const { session, calls } = fixture({
    record: async () => {
      if (++reads === 1) throw new Error("temporary failure");
      return { record: null };
    },
  });
  await session.initialize();
  await session.readRecord();
  assert.equal(calls.translate.length, 0);
  await session.generate();
  assert.equal(calls.translate.length, 1);
});

test("disabled/unreadable AI capability never generates automatically", async () => {
  for (const capabilities of [
    async () => ({ translation: { enabled: false } }),
    async () => {
      throw new Error("offline");
    },
  ]) {
    const { session, calls } = fixture({
      capabilities,
      record: async () => ({ record: null }),
    });
    await session.initialize();
    assert.equal(calls.translate.length, 0);
  }
});

test("failed explicit re-query keeps the previous result and exposes raw error", async () => {
  const { session } = fixture({
    translate: async () => {
      throw new Error("Provider HTTP 400: bad schema");
    },
  });
  await session.initialize();
  await session.generate();
  assert.equal(session.snapshot().result.text, saved.text);
  assert.equal(session.snapshot().aiError, "Provider HTTP 400: bad schema");
  assert.equal(session.snapshot().aiBusy, false);
});

test("AI does not block mastery or capture; closing ignores late AI results", async () => {
  const ai = deferred();
  const { session, calls } = fixture({
    record: async () => ({ record: null }),
    translate: () => ai.promise,
  });
  const initialization = session.initialize();
  await tick();
  assert.equal(session.snapshot().aiBusy, true);
  await session.mark("known");
  await session.capture();
  assert.deepEqual(calls.state, [["book", "known"]]);
  assert.equal(calls.capture.length, 1);
  assert.equal(calls.changed, 2);
  assert.equal(session.snapshot().word.state, "known");
  session.close();
  ai.resolve(generated);
  await initialization;
  assert.equal(session.snapshot().result, undefined);
});

test("late successful mutation still invalidates reader, but does not update closed card", async () => {
  const pending = deferred();
  const { session, calls } = fixture({ setState: () => pending.promise });
  await session.initialize();
  const writing = session.mark("known");
  session.close();
  pending.resolve();
  await writing;
  assert.equal(calls.changed, 1);
  assert.equal(session.snapshot().word.state, "unknown");
});

test("capture preview makes no AI call or visit; retry reuses frozen payload and key", async () => {
  const captures = [];
  const input = { ...selection, selection: { ...selection.selection } };
  const { session, calls } = fixture(
    {
      capture: async (payload, key) => {
        captures.push({ payload, key });
        if (captures.length === 1) throw new Error("network interrupted");
      },
    },
    "capture",
    input,
  );
  await session.initialize();
  await session.capture();
  input.selection.start = 0;
  input.selectedText = "changed";
  await session.mark("known");
  await session.capture();
  assert.equal(calls.visit.length, 0);
  assert.equal(calls.translate.length, 0);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].key, captures[1].key);
  assert.deepEqual(captures[0].payload, captures[1].payload);
  assert.equal(captures[0].payload.selectedText, "books");
  assert.equal(captures[0].payload.selection.start, 6);
  assert.equal(captures[0].payload.setTermState, undefined);
  await session.capture(true);
  assert.notEqual(captures[2].key, captures[0].key);
  assert.equal(captures[2].payload.kind, "sentence");
  assert.deepEqual(captures[2].payload.selection, {
    start: 0,
    end: selection.contextText.length,
  });
});

test("explicit translation uses translation purpose once, not dictionary cache or visits", async () => {
  const { session, calls } = fixture({}, "translate");
  await session.initialize();
  assert.deepEqual(calls.translate, [
    [selection.selectedText, selection.contextText, "translation"],
  ]);
  assert.equal(calls.record.length, 0);
  assert.equal(calls.visit.length, 0);
});

test("phrases use their saved key, never the single-word visit endpoint", async () => {
  const phrase = {
    ...selection,
    selectedText: "take off",
    contextText: "They take off soon.",
    selection: { start: 5, end: 13 },
    kind: "phrase",
    termKey: "take off",
  };
  const { session, calls } = fixture({}, "lookup", phrase);
  await session.initialize();
  assert.deepEqual(calls.record, [["take off"]]);
  assert.equal(calls.visit.length, 0);
});

test("oversized or mismatched snapshots are rejected without sending them", async () => {
  for (const input of [
    { ...selection, contextText: "x".repeat(4001) },
    { ...selection, selection: { start: 0, end: 5 } },
  ]) {
    const { session, calls } = fixture({}, "lookup", input);
    await session.initialize();
    await session.generate();
    await session.capture();
    assert.ok(session.invalidSelection);
    assert.equal(
      calls.visit.length +
        calls.record.length +
        calls.translate.length +
        calls.capture.length,
      0,
    );
  }
  assert.equal(selectionError(selection), "");
});

test("StrictMode start/cleanup/start cannot double-count visits or generate twice", async () => {
  const read = deferred();
  const { session, calls } = fixture({ record: () => read.promise });
  const first = session.initialize();
  session.close();
  const second = session.initialize();
  read.resolve({ record: null });
  await Promise.all([first, second]);
  assert.equal(calls.visit.length, 1);
  assert.equal(calls.translate.length, 1);
});

test("closing during cache read never starts AI afterwards", async () => {
  const read = deferred();
  const { session, calls } = fixture({ record: () => read.promise });
  const initialization = session.initialize();
  session.close();
  read.resolve({ record: null });
  await initialization;
  assert.equal(calls.translate.length, 0);
});
