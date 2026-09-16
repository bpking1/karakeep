import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { Check, Trash2 } from "lucide-react";

import {
  SUPPORTED_HIGHLIGHT_COLORS,
  ZHighlightColor,
} from "@karakeep/shared/types/highlights";

import { HIGHLIGHT_COLOR_MAP } from "./highlights";
import { Button } from "./ui/button";
import { Popover, PopoverContent } from "./ui/popover";
import { Textarea } from "./ui/textarea";

interface HighlightFormProps {
  position: { x: number; y: number } | null;
  selectedHighlight: Highlight | null;
  onClose: () => void;
  onSave: (color: ZHighlightColor, note: string | null) => void;
  onDelete?: () => void;
  onDismiss?: () => void;
  selectionActions?: readonly SelectionAction[];
  onSelectionAction?: (id: string) => void;
  isMobile: boolean;
}

const HighlightForm: React.FC<HighlightFormProps> = ({
  position,
  selectedHighlight,
  onClose,
  onSave,
  onDelete,
  onDismiss,
  selectionActions,
  onSelectionAction,
  isMobile,
}) => {
  const [selectedColor, setSelectedColor] = useState<ZHighlightColor>(
    selectedHighlight?.color || "yellow",
  );
  const [noteText, setNoteText] = useState(selectedHighlight?.note || "");

  // Update state when selectedHighlight changes
  useEffect(() => {
    setSelectedColor(selectedHighlight?.color || "yellow");
    setNoteText(selectedHighlight?.note || "");
  }, [selectedHighlight]);

  const handleSave = () => {
    onSave(selectedColor, noteText || null);
  };

  return (
    <Popover
      open={position !== null}
      onOpenChange={(val) => {
        if (!val) {
          (onDismiss ?? onClose)();
        }
      }}
    >
      <PopoverAnchor
        className="fixed"
        style={{
          left: position?.x,
          top: position?.y,
        }}
      />
      <PopoverContent
        side={isMobile ? "bottom" : "top"}
        className="w-80 space-y-3 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!!selectionActions?.length && selectedHighlight?.text && (
          <div className="flex flex-wrap gap-2" aria-label="Selection actions">
            {selectionActions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="outline"
                onClick={() => onSelectionAction?.(action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        <div>
          <label className="mb-2 block text-sm font-medium">Color</label>
          <div className="flex items-center gap-1">
            {SUPPORTED_HIGHLIGHT_COLORS.map((color) => (
              <Button
                size="none"
                key={color}
                onClick={() => setSelectedColor(color)}
                variant="none"
                className={cn(
                  `size-8 rounded-full hover:border focus-visible:ring-0`,
                  HIGHLIGHT_COLOR_MAP.bg[color],
                )}
              >
                {selectedColor === color && (
                  <Check className="size-5 text-gray-600" />
                )}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Note</label>
          <Textarea
            placeholder="Add a note (optional)..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            className="min-h-[80px] text-sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button onClick={handleSave} size="sm">
              Save
            </Button>
            <Button onClick={onClose} variant="outline" size="sm">
              Cancel
            </Button>
          </div>
          {selectedHighlight && onDelete && (
            <Button
              size="sm"
              onClick={onDelete}
              variant="ghost"
              title="Delete highlight"
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export interface Highlight {
  id: string;
  startOffset: number;
  endOffset: number;
  color: ZHighlightColor;
  text: string | null;
  note?: string | null;
}

export interface SelectionAction {
  id: string;
  label: string;
}
export type HighlightSelection = Pick<
  Highlight,
  "text" | "startOffset" | "endOffset"
>;
const EMPTY_HIGHLIGHTS: Highlight[] = [];

interface HTMLHighlighterProps {
  htmlContent: string;
  style?: React.CSSProperties;
  className?: string;
  highlights?: Highlight[];
  readOnly?: boolean;
  onHighlight?: (highlight: Highlight) => void;
  onUpdateHighlight?: (highlight: Highlight) => void;
  onDeleteHighlight?: (highlight: Highlight) => void;
  selectionActions?: readonly SelectionAction[];
  onSelectionAction?: (action: string, selection: HighlightSelection) => void;
  onContentReady?: () => void;
}

const BookmarkHTMLHighlighter = forwardRef<
  HTMLDivElement,
  HTMLHighlighterProps
>(function BookmarkHTMLHighlighter(
  {
    htmlContent,
    className,
    style,
    highlights = EMPTY_HIGHLIGHTS,
    readOnly = false,
    onHighlight,
    onUpdateHighlight,
    onDeleteHighlight,
    selectionActions,
    onSelectionAction,
    onContentReady,
  },
  ref,
) {
  const contentRef = useRef<HTMLDivElement>(null);
  // React compares this prop by identity. A fresh object rewrites innerHTML on
  // every menu render, invalidating manual annotations and native selections.
  const contentHTML = useMemo(() => ({ __html: htmlContent }), [htmlContent]);
  const onContentReadyRef = useRef(onContentReady);
  onContentReadyRef.current = onContentReady;

  // Expose the content div ref to parent components
  useImperativeHandle(ref, () => contentRef.current!, []);

  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<Highlight | null>(
    null,
  );
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(
    null,
  );
  const isMobile = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  )[0];

  // Apply existing highlights when component mounts or highlights change
  useEffect(() => {
    if (!contentRef.current) return;
    const selection = window.getSelection();
    const selectedRange =
      selection && !selection.isCollapsed && selection.rangeCount === 1
        ? selection.getRangeAt(0)
        : null;
    const preserved =
      selectedRange &&
      contentRef.current.contains(selectedRange.commonAncestorContainer)
        ? createHighlightFromRange(selectedRange, "yellow")
        : null;

    // Clear existing highlights first
    const existingHighlights = contentRef.current.querySelectorAll(
      "span[data-highlight]",
    );
    existingHighlights.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      }
    });

    // Apply all highlights
    highlights.forEach((highlight) => {
      applyHighlightByOffset(highlight);
    });
    if (preserved) {
      const ranges = getRangeFromHighlight(preserved);
      if (ranges?.length) {
        const restored = document.createRange();
        restored.setStart(ranges[0].node, ranges[0].start);
        const last = ranges[ranges.length - 1];
        restored.setEnd(last.node, last.end);
        selection?.removeAllRanges();
        selection?.addRange(restored);
      }
    }
    onContentReadyRef.current?.();
  }, [htmlContent, highlights]);

  useEffect(() => {
    setMenuPosition(null);
    setPendingHighlight(null);
    setSelectedHighlight(null);
  }, [htmlContent]);

  // Native text handles may update selection without a DOM pointerup. Only
  // observe them; never cancel long-press/context-menu events or rewrite ranges.
  useEffect(() => {
    if (!selectionActions?.length || readOnly) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
          return;
        const range = selection.getRangeAt(0);
        if (!contentRef.current?.contains(range.commonAncestorContainer))
          return;
        showSelection(range);
      }, 300);
    };
    document.addEventListener("selectionchange", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
    };
  }, [selectionActions, readOnly]);

  const showSelection = (range: Range) => {
    const rect = range.getBoundingClientRect();
    setMenuPosition({
      x: rect.left + rect.width / 2,
      y: isMobile ? rect.bottom : rect.top,
    });
    setSelectedHighlight(null);
    const next = createHighlightFromRange(range, "yellow");
    // Native selection notifications can repeat after pointerup or a server
    // annotation refresh. Preserve edits while the selected range is unchanged.
    setPendingHighlight((current) =>
      current &&
      next &&
      current.startOffset === next.startOffset &&
      current.endOffset === next.endOffset &&
      current.text === next.text
        ? current
        : next,
    );
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (readOnly) {
      return;
    }

    const selection = window.getSelection();

    // Check if we clicked on an existing highlight
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-highlight]",
    );
    if (target && (!selection || selection.isCollapsed)) {
      const highlightId = target.dataset.highlightId;
      if (highlightId && highlights) {
        const highlight = highlights.find((h) => h.id === highlightId);
        if (!highlight) {
          return;
        }
        setSelectedHighlight(highlight);
        setMenuPosition({
          x: e.clientX,
          y: e.clientY,
        });
        return;
      }
    }

    if (!selection || selection.isCollapsed || !contentRef.current) {
      return;
    }

    const range = selection.getRangeAt(0);

    // Only process selections within our component
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    showSelection(range);
  };

  const handleSave = (color: ZHighlightColor, note: string | null) => {
    if (pendingHighlight) {
      pendingHighlight.color = color;
      pendingHighlight.note = note;
      onHighlight?.(pendingHighlight);
    } else if (selectedHighlight) {
      selectedHighlight.color = color;
      selectedHighlight.note = note;
      onUpdateHighlight?.(selectedHighlight);
    }
    closeForm();
  };

  const closeForm = (clearSelection = true) => {
    setMenuPosition(null);
    setPendingHighlight(null);
    setSelectedHighlight(null);
    if (clearSelection) window.getSelection()?.removeAllRanges();
  };

  const handleDelete = () => {
    if (selectedHighlight && onDeleteHighlight) {
      onDeleteHighlight(selectedHighlight);
      closeForm();
    }
  };

  const createHighlightFromRange = (
    range: Range,
    color: ZHighlightColor,
  ): Highlight | null => {
    if (!contentRef.current) return null;

    if (
      !contentRef.current.contains(range.startContainer) ||
      !contentRef.current.contains(range.endContainer)
    )
      return null;
    const before = document.createRange();
    before.selectNodeContents(contentRef.current);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const endOffset = startOffset + range.toString().length;

    const highlight: Highlight = {
      id: "NOT_SET",
      startOffset,
      endOffset,
      color,
      text: range.toString(),
    };

    return highlight;
  };

  const getRangeFromHighlight = (highlight: Highlight) => {
    if (!contentRef.current) return;

    let currentOffset = 0;
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
      null,
    );

    const ranges: { node: Text; start: number; end: number }[] = [];

    // Find all text nodes that need highlighting
    let node: Text | null;
    while ((node = walker.nextNode() as Text)) {
      const nodeLength = node.length;
      const nodeStart = currentOffset;
      const nodeEnd = nodeStart + nodeLength;

      if (nodeStart < highlight.endOffset && nodeEnd > highlight.startOffset) {
        ranges.push({
          node,
          start: Math.max(0, highlight.startOffset - nodeStart),
          end: Math.min(nodeLength, highlight.endOffset - nodeStart),
        });
      }

      currentOffset += nodeLength;
    }
    return ranges;
  };

  const applyHighlightByOffset = (highlight: Highlight) => {
    const ranges = getRangeFromHighlight(highlight);
    if (!ranges) {
      return;
    }
    // Apply highlights to found ranges
    ranges.forEach(({ node, start, end }) => {
      if (start > 0) {
        node.splitText(start);
        node = node.nextSibling as Text;
        end -= start;
      }
      if (end < node.length) {
        node.splitText(end);
      }

      const span = document.createElement("span");
      span.classList.add(HIGHLIGHT_COLOR_MAP.bg[highlight.color]);
      span.classList.add("text-gray-600");
      span.dataset.highlight = "true";
      span.dataset.highlightId = highlight.id;
      node.parentNode?.insertBefore(span, node);
      span.appendChild(node);
    });
  };

  return (
    <div>
      <div
        role="presentation"
        ref={contentRef}
        dangerouslySetInnerHTML={contentHTML}
        onPointerUp={handlePointerUp}
        className={cn(
          "prose prose-neutral max-w-none break-words dark:prose-invert [&_code]:break-all [&_img]:h-auto [&_img]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto",
          className,
        )}
        style={style}
      />
      <HighlightForm
        position={menuPosition}
        selectedHighlight={selectedHighlight || pendingHighlight}
        onClose={() => closeForm()}
        onDismiss={() => closeForm(!selectionActions?.length)}
        selectionActions={selectionActions}
        onSelectionAction={(action) => {
          const current = window.getSelection();
          const range =
            current && !current.isCollapsed && current.rangeCount === 1
              ? current.getRangeAt(0)
              : null;
          const selection =
            range && contentRef.current?.contains(range.commonAncestorContainer)
              ? createHighlightFromRange(range, "yellow")
              : (pendingHighlight ?? selectedHighlight);
          if (selection) onSelectionAction?.(action, selection);
          closeForm();
        }}
        onSave={handleSave}
        onDelete={selectedHighlight ? handleDelete : undefined}
        isMobile={isMobile}
      />
    </div>
  );
});

export default BookmarkHTMLHighlighter;
