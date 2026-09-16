import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./test-support.mjs";
const study = load("study");
const { validateArticle } = load("reading");
const plain = (value) => JSON.parse(JSON.stringify(value));
const document = (text) => ({
  documentId: "bookmark-1",
  title: "A technical article",
  text,
  source: {
    kind: "karakeep",
    title: "A technical article",
    externalId: "bookmark-1",
    url: "https://example.com/article",
  },
});
const info = (
  input,
  termKey = input.toLowerCase(),
  state = "unknown",
  tags = [],
) => ({
  input,
  termKey,
  state,
  collected: false,
  entry: { tags, displayText: termKey },
});

test("complete article inventory counts every occurrence and preserves UTF16 source snapshots", () => {
  const inventory = study.createInventory(
    document("😀 We walk, walked and walk.\nA second walk."),
  );
  assert.equal(inventory.occurrences.get("walk").count, 3);
  const selection = inventory.occurrences.get("walk").selection;
  assert.equal(
    selection.contextText.slice(
      selection.selection.start,
      selection.selection.end,
    ),
    "walk",
  );
  assert.ok(selection.contextText.includes("walked"));
});

test("only equal server keys merge, retaining the first source context", () => {
  const inventory = study.createInventory(document("Walk walked walking."));
  const words = study.mergeInventory(inventory, [
    info("walking", "walking"),
    info("walked", "walk"),
    info("Walk", "walk"),
  ]);
  assert.equal(words.length, 2);
  assert.equal(words[0].termKey, "walk");
  assert.equal(words[0].count, 2);
  assert.equal(words[0].selection.selectedText, "Walk");
  assert.equal(words[1].termKey, "walking");
});

test("missing server result is an error, not a partial word count", () => {
  const inventory = study.createInventory(document("walk run"));
  assert.throws(
    () => study.mergeInventory(inventory, [info("walk")]),
    /不完整/,
  );
});

test("unmastered includes ignored; tags come from imported dictionary labels", () => {
  const inventory = study.createInventory(document("walk run skip"));
  const words = study.mergeInventory(inventory, [
    info("walk", "walk", "known", ["cet4"]),
    info("run", "run", "ignored", ["b1"]),
    info("skip"),
  ]);
  assert.deepEqual(
    Array.from(
      study.filterWords(words, "unmastered", "", ""),
      (word) => word.termKey,
    ),
    ["run", "skip"],
  );
  assert.equal(study.filterWords(words, "all", "b1", "RUN")[0].termKey, "run");
  assert.deepEqual(plain(study.wordTags(words[2])), ["ungraded"]);
});

test("selection survives changing filters and current-filter deselection preserves other tags", () => {
  let selected = study.toggleSelection(new Set(), ["walk"]);
  selected = study.toggleSelection(selected, ["run", "skip"]);
  assert.deepEqual([...selected], ["walk", "run", "skip"]);
  selected = study.toggleSelection(selected, ["run", "skip"]);
  assert.deepEqual([...selected], ["walk"]);
  selected = study.toggleSelection(selected, []);
  assert.deepEqual([...selected], ["walk"]);
});

test("learning targets do not locally discard inherited known or ignored states", () => {
  const inventory = study.createInventory(document("walk run"));
  const words = study.mergeInventory(inventory, [
    info("walk", "walk", "known"),
    info("run", "run", "ignored"),
  ]);
  assert.deepEqual(
    Array.from(
      study.selectedWords(words, new Set(["walk", "run"])),
      (word) => word.termKey,
    ),
    ["walk", "run"],
  );
});

test("practice pauses at 20 words and ends the final partial round without writes", () => {
  assert.deepEqual(plain(study.advancePractice(19, 25)), {
    position: 20,
    roundComplete: true,
  });
  assert.deepEqual(plain(study.advancePractice(24, 25)), {
    position: 25,
    roundComplete: false,
  });
  assert.deepEqual(plain(study.advancePractice(19, 20)), {
    position: 20,
    roundComplete: false,
  });
});

test("article limits fail explicitly rather than silently truncating", () => {
  assert.throws(() => study.createInventory(document(" ")), /正文/);
  assert.throws(() => validateArticle("中".repeat(700000)), /2 MiB/);
  assert.throws(
    () => study.createInventory(document("a ".repeat(100001))),
    /100000/,
  );
  const word = (number) => {
    let out = "word";
    do {
      out += String.fromCharCode(97 + (number % 26));
      number = Math.floor(number / 26);
    } while (number);
    return out;
  };
  assert.throws(
    () =>
      study.createInventory(
        document(
          Array.from({ length: 5001 }, (_, index) => word(index)).join(" "),
        ),
      ),
    /5000/,
  );
});
