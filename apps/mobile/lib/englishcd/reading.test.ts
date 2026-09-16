import assert from "node:assert/strict";
import { test } from "node:test";
import { phraseMatcher } from "./phrases";
import {
  highlightKind,
  isReadingTap,
  readingSelection,
  snapshotInText,
  utf8ByteLength,
  wordsIn,
} from "./reading";
import type { WordInfo } from "./types";

const word: WordInfo = {
  input: "Learners",
  termKey: "learner",
  state: "unknown",
  collected: false,
  entry: { displayText: "learner", tags: ["cet4"] },
};

test("surface extraction matches EnglishCD contractions, hyphens and UTF-16 offsets", () => {
  const text = "😀 Learners can’t re-enter John's room.";
  assert.deepEqual(
    wordsIn(text).map((token) => token.word),
    ["Learners", "can’t", "re-enter", "John's", "room"],
  );
  for (const token of wordsIn(text))
    assert.equal(text.slice(token.start, token.end), token.word);
  assert.equal(utf8ByteLength("😀中éa"), 10);
  assert.equal(utf8ByteLength("\ud800"), 3);
});

test("highlight rules use server state and tags, without treating ignored as known", () => {
  assert.equal(highlightKind(word, "cet4"), "new");
  assert.equal(highlightKind({ ...word, collected: true }), "collected");
  assert.equal(highlightKind({ ...word, state: "learning" }), "new");
  assert.equal(highlightKind({ ...word, state: "known" }), null);
  assert.equal(highlightKind({ ...word, state: "ignored" }), null);
  assert.equal(highlightKind(word, "cet6"), null);
});

test("phrases prefer longest saved term and do not cross punctuation or word boundaries", () => {
  const match = phraseMatcher([
    { termKey: "look up", state: "unknown" },
    { termKey: "look up to", state: "learning" },
    { termKey: "turn out", state: "known" },
    { termKey: "give up", state: "ignored" },
  ]);
  assert.equal(match("Look up to them.")[0].phrase, "look up to");
  assert.equal(match("look  up")[0].phrase, "look up");
  for (const text of [
    "look, up",
    "look-up",
    "1look up",
    "look up2",
    "turn out",
    "give up",
  ])
    assert.equal(
      match(text).some((token) => token.phrase),
      false,
      text,
    );
});

test("snapshots keep the real sentence and offset through non-ASCII context", () => {
  const text = "Before. 😀 Learners can’t leave. After.";
  const start = text.indexOf("Learners");
  const value = readingSelection("bookmark:one", text, start, start + 8)!;
  assert.equal(value.contextText.trim(), "😀 Learners can’t leave.");
  assert.equal(
    value.contextText.slice(value.selection.start, value.selection.end),
    "Learners",
  );
  assert.equal(value.kind, "word");
  assert.equal(readingSelection("one", text, -1, 2), null);
  assert.equal(readingSelection("one", "x".repeat(4001), 0, 4001), null);
});

test("large paragraphs and missing sentence segmentation retain bounded real context", () => {
  const text = "prefix " + "word ".repeat(5000) + "middle target suffix.";
  const start = text.indexOf("target");
  const snapshot = snapshotInText(text, start, start + 6);
  assert.ok(snapshot.contextText.length <= 4000);
  assert.ok(snapshot.contextText.includes("middle target suffix"));
  assert.equal(
    snapshot.contextText.slice(
      snapshot.selection.start,
      snapshot.selection.end,
    ),
    "target",
  );
  const original = Intl.Segmenter;
  Object.defineProperty(Intl, "Segmenter", {
    value: undefined,
    configurable: true,
  });
  try {
    assert.equal(
      snapshotInText(
        "Before. A target here. After.",
        10,
        16,
      ).contextText.trim(),
      "A target here.",
    );
  } finally {
    Object.defineProperty(Intl, "Segmenter", {
      value: original,
      configurable: true,
    });
  }
});

test("word taps reject long press, scroll, cancellation and non-primary clicks", () => {
  const press = { id: 1, x: 20, y: 30, started: 100, cancelled: false };
  const event = { timeStamp: 200, clientX: 20, clientY: 30, button: 0 };
  assert.equal(isReadingTap(press, event), true);
  assert.equal(isReadingTap(press, { ...event, timeStamp: 501 }), false);
  assert.equal(isReadingTap(press, { ...event, clientY: 45 }), false);
  assert.equal(isReadingTap({ ...press, cancelled: true }, event), false);
  assert.equal(isReadingTap(press, { ...event, button: 2 }), false);
  assert.equal(isReadingTap(null, event), false);
});
