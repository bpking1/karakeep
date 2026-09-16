// Narrow types from EnglishCD backend-design/openapi.json. No Karakeep credentials
// or complete article text belongs in a word lookup request.
export type WordState = "unknown" | "learning" | "known" | "ignored";
export type CaptureKind = "word" | "phrase" | "sentence";

export interface EnglishCDConnection {
  url: string;
  apiKey: string;
}

export interface EnglishCDSettings extends EnglishCDConnection {
  enabled: boolean;
  tag: string;
}

export interface Source {
  kind: string;
  url?: string;
  title?: string;
  externalId?: string;
}

export interface ReadingSelection {
  documentId: string;
  selectedText: string;
  contextText: string;
  selection: { start: number; end: number };
  kind?: CaptureKind;
  termKey?: string;
}

export interface ReadingDocument {
  documentId: string;
  title: string;
  text: string;
  source: Source;
}

export interface DictionaryEntry {
  displayText: string;
  phonetic?: string;
  meanings?: { pos?: string; gloss: string }[] | null;
  tags?: string[] | null;
  frequency?: Record<string, number | null> | null;
}

export interface WordInfo {
  input: string;
  termKey: string;
  state: WordState;
  entry?: DictionaryEntry | null;
  collected: boolean;
  lemmaCandidates?: string[];
}

export interface CollectedPhrase {
  termKey: string;
  state: WordState;
}

export interface AIDictionaryEntry {
  headword: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  sentence: string;
  sentenceTranslation: string;
  cefr: string;
}

export interface TranslationResult {
  text: string;
  targetLanguage: string;
  dictionary?: AIDictionaryEntry;
}

export interface DictionaryLookup extends TranslationResult {
  termKey: string;
  updatedAt: string;
}

export interface DictionaryLookupResult {
  record: DictionaryLookup | null;
}

export interface Capabilities {
  translation?: { enabled: boolean };
  dictionary?: { imported: boolean; version: string; tags: string[] };
}

export interface SetStatesResult {
  changed: number;
  vocabularyRevision: number;
}

export interface StartLearningResult extends SetStatesResult {
  skipped: number;
}

export interface CaptureRequest {
  kind: CaptureKind;
  language?: string;
  termKey?: string;
  selectedText: string;
  contextText: string;
  selection: { start: number; end: number };
  source: Source;
  setTermState?: WordState;
}

export interface CaptureResult {
  capture: { id: string };
  vocabularyRevision?: number;
}

export interface ImportRequest {
  kind: "text";
  language?: string;
  format: "plain";
  title: string;
  text: string;
  source: Omit<Source, "title">;
}

export interface ImportResult {
  contentId: string;
  trackId: string;
  kind: "text";
}
