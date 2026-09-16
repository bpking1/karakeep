"use dom";

import "@/globals.css";

import { useCallback, useEffect, useRef } from "react";
import { createReadingController } from "@/lib/englishcd/reading-dom";
import {
  rangeAtOffsets,
  selectionInRange,
} from "@/lib/englishcd/reading-dom-text";
import type { ReadingAction } from "@/lib/englishcd/reading";
import type {
  CollectedPhrase,
  ReadingSelection,
  WordInfo,
} from "@/lib/englishcd/types";

import type { Highlight } from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import BookmarkHTMLHighlighter from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import ScrollProgressTracker from "@karakeep/shared-react/components/ScrollProgressTracker";

const LEARNING_ACTIONS = [
  { id: "lookup", label: "查词" },
  { id: "translate", label: "翻译" },
  { id: "capture", label: "收藏到 EnglishCD" },
] as const;

export default function BookmarkHtmlHighlighterDom({
  htmlContent,
  contentStyle,
  isDark,
  highlights,
  readOnly,
  onHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onLinkPress,
  onImagePress,
  readingProgressOffset,
  readingProgressAnchor,
  restoreReadingPosition,
  onSavePosition,
  onScrollPositionChange,
  englishCDEnabled = false,
  englishCDDocumentId = "",
  englishCDTag = "",
  englishCDRevision = 0,
  onEnglishCDLookup,
  onEnglishCDPhrases,
  onEnglishCDOpen,
  onEnglishCDDocument,
  onEnglishCDError,
}: {
  htmlContent: string;
  contentStyle?: React.CSSProperties;
  isDark: boolean;
  highlights?: Highlight[];
  readOnly?: boolean;
  onHighlight?: (highlight: Highlight) => void;
  onUpdateHighlight?: (highlight: Highlight) => void;
  onDeleteHighlight?: (highlight: Highlight) => void;
  onLinkPress?: (url: string) => void;
  onImagePress?: (src: string) => void;
  readingProgressOffset?: number | null;
  readingProgressAnchor?: string | null;
  restoreReadingPosition?: boolean;
  onSavePosition?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  onScrollPositionChange?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  dom?: import("expo/dom").DOMProps;
  englishCDEnabled?: boolean;
  englishCDDocumentId?: string;
  englishCDTag?: string;
  englishCDRevision?: number;
  onEnglishCDLookup?: (words: string[]) => Promise<WordInfo[]>;
  onEnglishCDPhrases?: () => Promise<CollectedPhrase[]>;
  onEnglishCDOpen?: (
    selection: ReadingSelection,
    action: ReadingAction,
  ) => Promise<void>;
  onEnglishCDDocument?: (document: {
    documentId: string;
    text: string;
  }) => Promise<void>;
  onEnglishCDError?: (message: string) => Promise<void>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<ReturnType<typeof createReadingController> | null>(
    null,
  );
  const callbacks = useRef({
    onEnglishCDLookup,
    onEnglishCDPhrases,
    onEnglishCDOpen,
    onEnglishCDDocument,
    onEnglishCDError,
  });
  callbacks.current = {
    onEnglishCDLookup,
    onEnglishCDPhrases,
    onEnglishCDOpen,
    onEnglishCDDocument,
    onEnglishCDError,
  };
  const contentReady = useCallback(() => readingRef.current?.rebuild(), []);

  useEffect(() => {
    const root = contentRef.current;
    if (!englishCDEnabled || !englishCDDocumentId || !root) return;
    const controller = createReadingController(root, {
      documentId: englishCDDocumentId,
      tag: englishCDTag,
      lookup: async (words) =>
        (await callbacks.current.onEnglishCDLookup?.(words)) ?? [],
      phrases: async () =>
        (await callbacks.current.onEnglishCDPhrases?.()) ?? [],
      open: async (selection, action) => {
        await callbacks.current.onEnglishCDOpen?.(selection, action);
      },
      document: async (value) => {
        await callbacks.current.onEnglishCDDocument?.(value);
      },
      error: async (message) => {
        await callbacks.current.onEnglishCDError?.(message);
      },
    });
    readingRef.current = controller;
    return () => {
      controller.dispose();
      readingRef.current = null;
    };
  }, [
    htmlContent,
    englishCDEnabled,
    englishCDDocumentId,
    englishCDTag,
    englishCDRevision,
  ]);
  // Strip href from links so the browser treats them as regular selectable text
  // instead of activating native link gestures (iOS preview, Android drag).
  // The URL is preserved in data-href for our click handler.
  useEffect(() => {
    const stripHrefs = () => {
      document.querySelectorAll("a[href]").forEach((a) => {
        const anchor = a as HTMLAnchorElement;
        if (!anchor.dataset.href) {
          anchor.dataset.href = anchor.getAttribute("href")!;
          anchor.removeAttribute("href");
        }
      });
    };

    stripHrefs();

    // Re-strip if the DOM changes (e.g. highlight effects re-render content)
    const observer = new MutationObserver(stripHrefs);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  // Intercept link and image clicks to open them externally
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't intercept if the user is selecting text (for highlighting)
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }

      // Check for link clicks (href is stored in data-href)
      const anchor = target.closest("a");
      const href = anchor?.dataset.href;
      if (href) {
        // Allow in-page anchor links
        if (href.startsWith("#")) {
          const targetEl = document.querySelector(href);
          if (targetEl) {
            targetEl.scrollIntoView();
          }
          return;
        }
        // Ignore javascript: URLs
        if (href.startsWith("javascript:")) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onLinkPress?.(href);
        return;
      }

      // Check for image clicks
      const img = target.closest("img");
      if (img?.src) {
        e.preventDefault();
        onImagePress?.(img.src);
        return;
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onLinkPress, onImagePress]);
  return (
    <div
      className={isDark ? "dark" : undefined}
      style={{ maxWidth: "100vw", overflowX: "hidden" }}
    >
      <ScrollProgressTracker
        onSavePosition={onSavePosition}
        onScrollPositionChange={onScrollPositionChange}
        restorePosition={restoreReadingPosition}
        readingProgressOffset={readingProgressOffset}
        readingProgressAnchor={readingProgressAnchor}
        showProgressBar
        progressBarStyle={{ position: "fixed" }}
      >
        <BookmarkHTMLHighlighter
          ref={contentRef}
          className="dark:[&_*]:!text-inherit dark:[&_[data-highlight]]:!text-gray-600 dark:[&_a]:!text-[var(--tw-prose-links)]"
          htmlContent={htmlContent}
          highlights={highlights}
          readOnly={readOnly}
          onHighlight={onHighlight}
          onUpdateHighlight={onUpdateHighlight}
          onDeleteHighlight={onDeleteHighlight}
          onContentReady={contentReady}
          selectionActions={englishCDEnabled ? LEARNING_ACTIONS : undefined}
          onSelectionAction={(action, selection) => {
            const root = contentRef.current;
            if (
              !englishCDEnabled ||
              !root ||
              !LEARNING_ACTIONS.some((item) => item.id === action)
            )
              return;
            try {
              const range = rangeAtOffsets(
                root,
                selection.startOffset,
                selection.endOffset,
              );
              const value =
                range && selectionInRange(root, range, englishCDDocumentId);
              if (!value) {
                void onEnglishCDError?.(
                  "请选择正文中的文字，且不超过 4000 个字符。",
                );
                return;
              }
              void onEnglishCDOpen?.(value, action as ReadingAction).catch(() =>
                onEnglishCDError?.("无法打开 EnglishCD 选区操作。"),
              );
            } catch {
              void onEnglishCDError?.("无法读取当前选区，请重新选择。");
            }
          }}
          style={contentStyle}
        />
      </ScrollProgressTracker>
    </div>
  );
}
