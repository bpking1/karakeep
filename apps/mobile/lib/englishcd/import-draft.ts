import { validateArticle } from "./reading";
import type { ImportRequest, ReadingDocument } from "./types";

export interface ImportAttempt {
  payload: ImportRequest;
  identity: string;
  key: string;
}

// A manual retry reuses precisely the same request. Editing the payload gets a
// new key; nothing is persisted and opening a preview never sends a request.
export function prepareImportAttempt(
  previous: ImportAttempt | undefined,
  document: ReadingDocument,
  title: string,
  text: string,
  key: () => string,
): ImportAttempt {
  validateArticle(text);
  if (!title.trim() || title.trim().length > 500)
    throw new Error("请填写 1–500 字符的资料标题");
  const { kind, url, externalId } = document.source;
  const payload: ImportRequest = {
    kind: "text",
    format: "plain",
    language: "en",
    title: title.trim(),
    text,
    source: { kind, url, externalId },
  };
  const identity = JSON.stringify(payload);
  return previous?.identity === identity
    ? previous
    : { payload, identity, key: key() };
}
