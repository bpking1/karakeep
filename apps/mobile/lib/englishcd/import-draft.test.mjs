import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./test-support.mjs";
const { prepareImportAttempt } = load("import-draft");
const plain = (value) => JSON.parse(JSON.stringify(value));
const document = {
  documentId: "bookmark-1",
  title: "Original title",
  text: "Full original text.",
  source: {
    kind: "karakeep",
    externalId: "bookmark-1",
    title: "Original title",
    url: "https://example.com/article",
  },
};

test("import preview preparation has no side effects; identical retry reuses frozen payload/key", () => {
  let keys = 0;
  const key = () => `request-key-${++keys}`;
  const first = prepareImportAttempt(
    undefined,
    document,
    document.title,
    document.text,
    key,
  );
  const retry = prepareImportAttempt(
    first,
    document,
    document.title,
    document.text,
    key,
  );
  assert.equal(retry, first);
  assert.equal(keys, 1);
  assert.deepEqual(plain(first.payload.source), {
    kind: "karakeep",
    url: document.source.url,
    externalId: "bookmark-1",
  });
  assert.equal(first.payload.kind, "text");
  assert.equal(first.payload.format, "plain");
  const edited = prepareImportAttempt(
    retry,
    document,
    "New title",
    "Edited text",
    key,
  );
  assert.notEqual(edited.key, first.key);
  assert.equal(first.payload.text, document.text);
  assert.equal(edited.payload.text, "Edited text");
});

test("invalid import draft does not allocate a request or key", () => {
  const key = () => {
    throw new Error("should not allocate");
  };
  assert.throws(
    () => prepareImportAttempt(undefined, document, "", "body", key),
    /标题/,
  );
  assert.throws(
    () => prepareImportAttempt(undefined, document, "Title", "", key),
    /正文/,
  );
});
