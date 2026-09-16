import type { EnglishCDClient } from "./client";
import type {
  CaptureRequest,
  ReadingSelection,
  Source,
  TranslationResult,
  WordInfo,
  WordState,
} from "./types";

export type WordCardAction = "lookup" | "translate" | "capture";
type CardKind = "word" | "phrase" | "sentence";
type CardClient = Pick<
  EnglishCDClient,
  | "lookup"
  | "record"
  | "capabilities"
  | "translate"
  | "visit"
  | "setState"
  | "capture"
>;

export const wordStateLabels: Record<WordState, string> = {
  unknown: "未掌握",
  learning: "学习中",
  known: "已掌握",
  ignored: "忽略",
};

export interface WordCardSnapshot {
  kind: CardKind;
  word?: WordInfo;
  result?: TranslationResult;
  cached: boolean;
  aiBusy: boolean;
  writeBusy: boolean;
  recordReady: boolean;
  translationEnabled: boolean;
  capabilitiesReady: boolean;
  recordError: string;
  capabilityError: string;
  visitError: string;
  aiError: string;
  writeError: string;
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A request identity, not a secret. Works in React Native without Web Crypto.
let requestSequence = 0;
function requestKey(): string {
  return `card-${Date.now().toString(36)}-${++requestSequence}-${Math.random().toString(36).slice(2)}`;
}

export function selectionError(value: ReadingSelection): string {
  const { start, end } = value.selection;
  if (
    !value.selectedText.trim() ||
    value.contextText.length > 4000 ||
    value.selectedText.length > 4000
  ) {
    return "请选择不超过 4000 字符的文本；此选区不会被截断或发送。";
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > value.contextText.length ||
    value.contextText.slice(start, end) !== value.selectedText
  ) {
    return "选区与原文已不一致，请关闭卡片并重新选择。";
  }
  return "";
}

/** One explicit card opening. No storage, HTTP, or reader DOM ownership. */
export class WordCardSession {
  readonly selection: ReadingSelection;
  readonly source: Source;
  readonly invalidSelection: string;
  private value: WordCardSnapshot;
  private listeners = new Set<() => void>();
  private alive = false;
  private generation = 0;
  private wordRequest = 0;
  private visited = false;
  private aiAttempted = false;
  private recordMissing = false;
  private captures = new Map<
    boolean,
    { payload: CaptureRequest; key: string }
  >();
  private client: CardClient;
  readonly action: WordCardAction;
  private changed: () => void;
  private key: () => string;

  constructor(
    client: CardClient,
    selection: ReadingSelection,
    source: Source,
    action: WordCardAction,
    changed: () => void,
    key: () => string = requestKey,
  ) {
    this.client = client;
    this.action = action;
    this.changed = changed;
    this.key = key;
    this.selection = { ...selection, selection: { ...selection.selection } };
    this.source = { ...source };
    this.invalidSelection = selectionError(this.selection);
    this.value = {
      kind:
        selection.kind ??
        (/^[A-Za-z]+(?:['’ʼ-][A-Za-z]+)*$/.test(selection.selectedText)
          ? "word"
          : "sentence"),
      cached: false,
      aiBusy: false,
      writeBusy: false,
      recordReady: false,
      translationEnabled: false,
      capabilitiesReady: false,
      recordError: "",
      capabilityError: "",
      visitError: "",
      aiError: "",
      writeError: "",
      message: "",
    };
  }

  snapshot = (): WordCardSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<WordCardSnapshot>): void {
    if (!this.alive) return;
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private current(generation: number): boolean {
    return this.alive && generation === this.generation;
  }
  private dictionaryMode(): boolean {
    return this.action !== "translate" && this.value.kind !== "sentence";
  }

  async initialize(): Promise<void> {
    if (this.alive) return;
    this.alive = true;
    const generation = ++this.generation;
    this.update({ aiBusy: false, writeBusy: false });
    if (this.invalidSelection) return;
    if (this.value.kind !== "sentence") void this.lookup();
    // The visits endpoint accepts one word only. Translation/capture previews are not visits.
    if (
      this.action === "lookup" &&
      this.value.kind === "word" &&
      !this.visited
    ) {
      this.visited = true;
      void this.client
        .visit(this.selection.selectedText, this.key())
        .catch((error: unknown) => {
          if (this.current(generation))
            this.update({
              visitError: `查阅次数未保存：${errorMessage(error)}`,
            });
        });
    }
    await Promise.all([this.readCapabilities(), this.readRecord()]);
    if (
      this.current(generation) &&
      !this.aiAttempted &&
      this.action !== "capture" &&
      (this.action === "translate" ||
        (this.dictionaryMode() && this.recordMissing))
    ) {
      await this.generate();
    }
  }

  close(): void {
    this.alive = false;
    this.generation++;
    this.wordRequest++;
  }

  async lookup(): Promise<void> {
    if (!this.alive || this.invalidSelection || this.value.kind === "sentence")
      return;
    const generation = this.generation;
    const request = ++this.wordRequest;
    try {
      const words = await this.client.lookup([
        this.selection.termKey || this.selection.selectedText.trim(),
      ]);
      if (this.current(generation) && request === this.wordRequest)
        this.update({ word: words[0] });
    } catch (error) {
      if (this.current(generation) && request === this.wordRequest)
        this.update({ writeError: errorMessage(error) });
    }
  }

  async readCapabilities(): Promise<void> {
    if (!this.alive || this.invalidSelection) return;
    const generation = this.generation;
    this.update({ capabilityError: "" });
    try {
      const result = await this.client.capabilities();
      if (this.current(generation))
        this.update({
          capabilitiesReady: true,
          translationEnabled: result.translation?.enabled === true,
        });
    } catch (error) {
      if (this.current(generation))
        this.update({
          capabilitiesReady: false,
          capabilityError: errorMessage(error),
        });
    }
  }

  async readRecord(): Promise<void> {
    if (!this.alive || this.invalidSelection || this.value.aiBusy) return;
    if (!this.dictionaryMode()) {
      this.update({ recordReady: true });
      return;
    }
    const generation = this.generation;
    this.recordMissing = false;
    this.update({ aiBusy: true, recordReady: false, recordError: "" });
    try {
      const term =
        this.value.kind === "phrase"
          ? this.selection.termKey || this.selection.selectedText
          : this.selection.selectedText;
      const result = await this.client.record(term);
      if (!this.current(generation)) return;
      if (result.record === undefined)
        throw new Error("查词记录响应缺少 record 字段");
      this.recordMissing = result.record === null;
      this.update({
        recordReady: true,
        ...(result.record ? { result: result.record, cached: true } : {}),
      });
    } catch (error) {
      if (this.current(generation))
        this.update({ recordError: errorMessage(error), recordReady: false });
    } finally {
      if (this.current(generation)) this.update({ aiBusy: false });
    }
  }

  async generate(): Promise<void> {
    if (
      !this.alive ||
      this.invalidSelection ||
      this.value.aiBusy ||
      !this.value.recordReady ||
      !this.value.capabilitiesReady ||
      !this.value.translationEnabled
    )
      return;
    const generation = this.generation;
    this.aiAttempted = true;
    this.update({ aiBusy: true, aiError: "" });
    try {
      const result = await this.client.translate(
        this.selection.selectedText,
        this.selection.contextText,
        this.dictionaryMode() ? "dictionary" : "translation",
      );
      if (this.current(generation)) this.update({ result, cached: false });
    } catch (error) {
      // A failed re-query leaves the previous saved/generated result visible.
      if (this.current(generation))
        this.update({ aiError: errorMessage(error) });
    } finally {
      if (this.current(generation)) this.update({ aiBusy: false });
    }
  }

  setKind(kind: CardKind): void {
    if (
      !this.alive ||
      this.value.aiBusy ||
      this.value.writeBusy ||
      kind === this.value.kind
    )
      return;
    this.generation++;
    this.wordRequest++;
    this.captures.clear();
    this.recordMissing = false;
    this.update({
      kind,
      word: undefined,
      result: undefined,
      cached: false,
      recordReady: false,
      recordError: "",
      aiError: "",
      writeError: "",
      message: "",
    });
    if (kind !== "sentence") void this.lookup();
    void this.readCapabilities();
    void this.readRecord();
  }

  async mark(state: WordState): Promise<void> {
    const termKey = this.selection.termKey || this.value.word?.termKey;
    if (
      !this.alive ||
      this.invalidSelection ||
      this.value.writeBusy ||
      this.value.kind === "sentence" ||
      !termKey
    )
      return;
    const generation = this.generation;
    this.wordRequest++;
    this.update({ writeBusy: true, writeError: "", message: "" });
    try {
      await this.client.setState(termKey, state);
      this.changed();
      if (!this.current(generation)) return;
      this.update({
        word: {
          input: this.selection.selectedText,
          termKey,
          collected: false,
          ...this.value.word,
          state,
        },
        message: `已标记为${wordStateLabels[state]}`,
      });
    } catch (error) {
      if (this.current(generation))
        this.update({ writeError: errorMessage(error) });
    } finally {
      if (this.current(generation)) this.update({ writeBusy: false });
    }
  }

  async capture(sentence = false): Promise<void> {
    if (!this.alive || this.invalidSelection || this.value.writeBusy) return;
    const generation = this.generation;
    let request = this.captures.get(sentence);
    if (!request) {
      const value = this.selection;
      const kind = sentence ? "sentence" : this.value.kind;
      const payload: CaptureRequest = {
        kind,
        language: "en",
        selectedText: sentence ? value.contextText : value.selectedText,
        contextText: value.contextText,
        selection: sentence
          ? { start: 0, end: value.contextText.length }
          : { ...value.selection },
        source: { ...this.source },
        ...(kind !== "sentence"
          ? { termKey: value.termKey || value.selectedText.trim() }
          : {}),
      };
      request = { payload, key: this.key() };
      this.captures.set(sentence, request);
    }
    this.update({ writeBusy: true, writeError: "", message: "" });
    try {
      await this.client.capture(request.payload, request.key);
      this.changed();
      if (!this.current(generation)) return;
      this.wordRequest++;
      this.update({
        message: sentence ? "原句已收藏" : "选区已收藏，掌握状态未改变",
        ...(!sentence && this.value.word
          ? { word: { ...this.value.word, collected: true } }
          : {}),
      });
    } catch (error) {
      if (this.current(generation))
        this.update({ writeError: errorMessage(error) });
    } finally {
      if (this.current(generation)) this.update({ writeBusy: false });
    }
  }
}
