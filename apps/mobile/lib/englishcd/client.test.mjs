import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./test-support.mjs";

const connection = {
  url: "https://english.invalid/nested/",
  apiKey: "private-token",
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
const plain = (value) => JSON.parse(JSON.stringify(value));
const word = (input, state = "unknown") => ({
  input,
  termKey: input.toLowerCase(),
  state,
  collected: false,
  entry: null,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client(fetch, globals) {
  const { EnglishCDClient } = load(
    "client",
    { "expo/fetch": { fetch } },
    globals,
  );
  return new EnglishCDClient(connection);
}

test("connection keeps subpath and rejects credentials, query and invalid protocols", () => {
  const { normalizeConnection } = load("client", { "expo/fetch": {} });
  assert.deepEqual(plain(normalizeConnection(connection)), {
    ...connection,
    url: "https://english.invalid/nested",
  });
  for (const url of [
    "file:///tmp/server",
    "https://name:secret@host",
    "https://host/?token=secret",
    "https://host/#fragment",
    "not a url",
  ]) {
    assert.throws(() => normalizeConnection({ ...connection, url }));
  }
  assert.throws(() => normalizeConnection({ ...connection, apiKey: "\n" }));
});

test("Bearer is isolated in headers, subpath retained, redirect and cookies disabled", async () => {
  let request;
  const api = client(async (...args) => {
    request = args;
    return json({ translation: { enabled: true } });
  });
  await api.capabilities();
  const [url, init] = request;
  assert.equal(url, "https://english.invalid/nested/api/v1/capabilities");
  assert.equal(init.headers.Authorization, "Bearer private-token");
  assert.equal(init.headers["Cache-Control"], "no-store");
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.equal(init.body, undefined);
  assert.ok(!url.includes(connection.apiKey));
});

test("lookups batch at 500, deduplicate in-flight words and reuse short-lived values", async () => {
  const first = deferred();
  const batches = [];
  const api = client(async (_url, init) => {
    const inputs = JSON.parse(init.body).words;
    batches.push(inputs);
    if (batches.length === 1) await first.promise;
    return json({ items: inputs.map((value) => word(value)) });
  });
  const inputs = Array.from({ length: 1001 }, (_, index) => "word" + index);
  const pending = api.lookup(inputs);
  const same = api.lookup(["word0", "word3"]);
  assert.equal(batches.length, 1);
  first.resolve();
  assert.equal((await pending).length, 1001);
  assert.deepEqual(
    Array.from(await same, (item) => item.input),
    ["word0", "word3"],
  );
  await api.lookup(["word0"]);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [500, 500, 1],
  );
  api.invalidate();
  await api.lookup(["word0"]);
  assert.equal(batches.length, 4);
});

test("cache expiry and invalidation cannot be undone by old in-flight reads", async () => {
  const { WordLookupCache } = load("cache");
  let now = 0;
  const cache = new WordLookupCache(30, () => now);
  const slow = deferred();
  const old = cache.lookup(["walk"], () => slow.promise);
  cache.invalidate();
  const fresh = await cache.lookup(["walk"], async () => [
    word("walk", "known"),
  ]);
  slow.resolve([word("walk")]);
  await old;
  assert.equal(fresh[0].state, "known");
  assert.equal(
    (
      await cache.lookup(["walk"], async () => {
        throw new Error("cached");
      })
    )[0].state,
    "known",
  );
  now = 31;
  assert.equal(
    (await cache.lookup(["walk"], async () => [word("walk", "learning")]))[0]
      .state,
    "learning",
  );
});

test("incomplete lookup fails without caching partial results or automatic retry", async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json({ items: [word("walk")] });
  });
  await assert.rejects(api.lookup(["walk", "run"]), /不完整/);
  assert.equal(calls, 1);
  await api.lookup(["walk"]);
  assert.equal(calls, 2);
});

test("phrases collect all pages and reject a repeated cursor", async () => {
  const pages = [];
  const api = client(async (url) => {
    pages.push(url);
    return json({
      items: [
        {
          termKey: pages.length === 1 ? "look up" : "take care",
          state: "unknown",
        },
      ],
      nextCursor: pages.length === 1 ? "page two" : null,
    });
  });
  assert.equal((await api.phrases()).length, 2);
  assert.match(pages[1], /cursor=page%20two$/);
  await api.phrases();
  assert.equal(pages.length, 2);
  let calls = 0;
  const broken = client(async () => {
    calls++;
    return json({ items: [], nextCursor: "repeat" });
  });
  await assert.rejects(broken.phrases(), /分页重复/);
  assert.equal(calls, 2);
});

test("missing AI record stays distinct from malformed and failed reads", async () => {
  const bodies = [
    { record: null },
    {},
    { error: { message: "original backend error" } },
  ];
  let calls = 0;
  const api = client(async (url) => {
    assert.match(url, /dictionary-lookups\/walked\?targetLanguage=zh-CN$/);
    const index = calls++;
    return json(bodies[index], index === 2 ? 500 : 200);
  });
  assert.equal((await api.record("walked")).record, null);
  await assert.rejects(api.record("walked"), /record/);
  await assert.rejects(api.record("walked"), /original backend error/);
  assert.equal(calls, 3);
});

test("malformed false records cannot masquerade as a cache miss", async () => {
  const api = client(async () => json({ record: false }));
  await assert.rejects(api.record("walked"), /不完整/);
});

test("write contracts retain exact term keys, fixed idempotency keys and invalidate words", async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/words/lookup")) return json({ items: [word("walked")] });
    if (url.endsWith("/word-visits"))
      return new Response(null, { status: 204 });
    return json({
      changed: 1,
      skipped: 0,
      vocabularyRevision: 2,
      capture: { id: "capture" },
      term: { termKey: "walked", state: "known" },
    });
  });
  await api.lookup(["walked"]);
  await api.setState("walked", "known");
  await api.lookup(["walked"]);
  await api.setStates(["walked", "take care"], "ignored");
  await api.learning(["walked", "take care"]);
  await api.visit("walked", "visit-key-0001");
  const capture = {
    kind: "word",
    termKey: "walked",
    selectedText: "walked",
    contextText: "I walked.",
    selection: { start: 2, end: 8 },
    source: { kind: "karakeep", externalId: "bookmark" },
  };
  await api.capture(capture, "capture-key-0001");
  await api.capture(capture, "capture-key-0001");
  assert.equal(
    calls.filter((call) => call.url.endsWith("/words/lookup")).length,
    2,
  );
  assert.equal(
    calls.find((call) => call.url.endsWith("/vocabulary/state")).body.termKey,
    "walked",
  );
  assert.deepEqual(
    calls.find((call) => call.url.endsWith("/vocabulary/learning")).body,
    { terms: ["walked", "take care"] },
  );
  const captures = calls.filter((call) => call.url.endsWith("/captures"));
  assert.equal(
    captures[0].init.headers["Idempotency-Key"],
    captures[1].init.headers["Idempotency-Key"],
  );
  assert.deepEqual(captures[0].body, capture);
  assert.ok(!Object.hasOwn(captures[0].body, "setTermState"));
});

test("translation sends bounded caller context once and preserves old backend errors without secrets", async () => {
  let calls = 0;
  const api = client(async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), {
      text: "bank",
      paragraphs: "The river bank.",
      purpose: "dictionary",
      targetLanguage: "zh-CN",
    });
    return json(
      { error: { message: "upstream private-token timed out" } },
      502,
    );
  });
  await assert.rejects(
    api.translate("bank", "The river bank."),
    /upstream \[已隐藏\] timed out/,
  );
  assert.equal(calls, 1);
});

test("explicit imports retain payload identity and create token-free browser links", async () => {
  let request;
  const api = client(async (...args) => {
    request = args;
    return json({ contentId: "content", trackId: "track", kind: "text" }, 201);
  });
  const payload = {
    kind: "text",
    format: "plain",
    title: "Article",
    text: "Full article",
    source: {
      kind: "karakeep",
      externalId: "bookmark",
      url: "https://article.invalid",
    },
  };
  const result = await api.import(payload, "import-key-0001");
  assert.deepEqual(JSON.parse(request[1].body), payload);
  assert.equal(request[1].headers["Idempotency-Key"], "import-key-0001");
  assert.equal(
    api.libraryURL(result),
    "https://english.invalid/nested/#/library/content?track=track",
  );
});

test("close cancels in-flight requests and prevents future cached or network reads", async () => {
  let started;
  const api = client(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        started = true;
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const pending = api.lookup(["walk"]);
  assert.equal(started, true);
  api.close();
  await assert.rejects(pending, /aborted/);
  await assert.rejects(api.lookup(["walk"]), /已关闭/);
  await assert.rejects(api.phrases(), /已关闭/);
});

test("request timeout aborts once and reports manual retry", async () => {
  let expire;
  let calls = 0;
  const api = client(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        calls++;
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
    {
      setTimeout: (callback) => {
        expire = callback;
        return 1;
      },
      clearTimeout() {
        // This mock never allocates a real timer.
      },
    },
  );
  const pending = api.capabilities();
  expire();
  await assert.rejects(pending, /超时.*手动重试/);
  assert.equal(calls, 1);
});

function settingsModule(storage) {
  return load("settings", {
    "expo/fetch": {},
    "expo-secure-store": storage,
    react: {
      useEffect() {
        // Store tests invoke load explicitly without mounting React.
      },
    },
    zustand: {
      create: (initialize) => {
        let state;
        const get = () => state;
        const set = (patch) => {
          state = {
            ...state,
            ...(typeof patch === "function" ? patch(state) : patch),
          };
        };
        state = initialize(set, get);
        return Object.assign(() => state, { getState: get });
      },
    },
  });
}

test("settings use only their own secure key, normalize tags and never enable invalid storage", async () => {
  const writes = [];
  const module = settingsModule({
    getItemAsync: async (key) => {
      assert.equal(key, "englishcd.settings.v1");
      return "broken JSON";
    },
    setItemAsync: async (...args) => {
      writes.push(args);
    },
  });
  const store = module.useEnglishCDStore;
  await store.getState().load();
  assert.equal(store.getState().settings.enabled, false);
  assert.match(store.getState().error, /读取失败/);
  await store
    .getState()
    .setSettings({ ...connection, enabled: true, tag: " CET4 " });
  assert.equal(writes[0][0], "englishcd.settings.v1");
  assert.equal(store.getState().settings.tag, "cet4");
  assert.equal(store.getState().settings.url, "https://english.invalid/nested");
  assert.equal(store.getState().error, "");
});

test("a late secure load cannot override a newly saved connection", async () => {
  const old = deferred();
  const module = settingsModule({
    getItemAsync: () => old.promise,
    setItemAsync: async () => undefined,
  });
  const store = module.useEnglishCDStore;
  const loading = store.getState().load();
  await store.getState().setSettings({ ...connection, enabled: true, tag: "" });
  old.resolve(JSON.stringify({ enabled: false, url: "", apiKey: "", tag: "" }));
  await loading;
  assert.equal(store.getState().settings.enabled, true);
  assert.equal(store.getState().settings.apiKey, connection.apiKey);
});

test("failed secure writes keep the previous active connection and expose no token", async () => {
  const module = settingsModule({
    getItemAsync: async () => null,
    setItemAsync: async () => {
      throw new Error("private-token");
    },
  });
  const store = module.useEnglishCDStore;
  await store.getState().load();
  await assert.rejects(
    store.getState().setSettings({ ...connection, enabled: true, tag: "" }),
    /保存失败/,
  );
  assert.equal(store.getState().settings.enabled, false);
  assert.equal(store.getState().settings.apiKey, "");
});
