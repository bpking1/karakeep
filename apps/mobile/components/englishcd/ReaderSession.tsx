import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import WordCard from "@/components/englishcd/WordCard";
import { StudyPanel } from "@/components/englishcd/StudyPanel";
import { ImportPanel } from "@/components/englishcd/ImportPanel";
import { EnglishCDClient } from "@/lib/englishcd/client";
import { useEnglishCDSettings } from "@/lib/englishcd/settings";
import { selectionError } from "@/lib/englishcd/word-card";
import type {
  CollectedPhrase,
  ReadingDocument,
  ReadingSelection,
  Source,
  WordInfo,
} from "@/lib/englishcd/types";

type ReadingAction = "lookup" | "translate" | "capture";

interface ReaderSessionValue {
  enabled: boolean;
  tag: string;
  revision: number;
  documentId: string;
  error: string;
  lookup: (words: string[]) => Promise<WordInfo[]>;
  phrases: () => Promise<CollectedPhrase[]>;
  open: (selection: ReadingSelection, action: ReadingAction) => Promise<void>;
  publish: (document: { documentId: string; text: string }) => Promise<void>;
  reportError: (message: string) => Promise<void>;
  refresh: () => void;
  supported: boolean;
  ready: boolean;
  showStudy: () => void;
  showImport: () => void;
}

const Context = createContext<ReaderSessionValue | null>(null);
export function useEnglishCDReader() {
  return useContext(Context);
}

// Scoped to one bookmark's Reader view. No article data enters the app query cache.
export function EnglishCDReaderSession({
  documentId,
  source,
  title,
  supported,
  children,
}: {
  documentId: string;
  source: Source;
  title: string;
  supported: boolean;
  children: ReactNode;
}) {
  const { settings, isLoading } = useEnglishCDSettings();
  const [connection, setConnection] = useState<{
    client: EnglishCDClient;
    url: string;
    apiKey: string;
  }>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [document, setDocument] = useState<ReadingDocument>();
  const [panel, setPanel] = useState<"study" | "import">();
  const [card, setCard] = useState<{
    id: number;
    selection: ReadingSelection;
    action: ReadingAction;
  }>();
  const sequence = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const titleRef = useRef(title);
  titleRef.current = title;
  const enabled = supported && !isLoading && settings.enabled;
  const client =
    enabled &&
    connection?.url === settings.url &&
    connection.apiKey === settings.apiKey
      ? connection.client
      : undefined;

  useEffect(() => {
    setCard(undefined);
    setDocument(undefined);
    setPanel(undefined);
    setError("");
    if (!enabled) {
      setConnection(undefined);
      return;
    }
    const next = new EnglishCDClient({
      url: settings.url,
      apiKey: settings.apiKey,
    });
    setConnection({ client: next, url: settings.url, apiKey: settings.apiKey });
    return () => next.close();
  }, [enabled, settings.url, settings.apiKey, documentId]);

  const refresh = useCallback(() => {
    client?.invalidate();
    setRevision((value) => value + 1);
    setError("");
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [client, refresh]);

  const lookup = useCallback(
    async (words: string[]) => {
      if (!client) return [];
      return client.lookup(words);
    },
    [client],
  );
  const phrases = useCallback(
    async () => (client ? client.phrases() : []),
    [client],
  );
  const publish = useCallback(
    async (value: { documentId: string; text: string }) => {
      if (!client || value.documentId !== documentId) return;
      setDocument((previous) =>
        previous?.text === value.text
          ? previous
          : {
              documentId,
              text: value.text,
              title: titleRef.current,
              source: sourceRef.current,
            },
      );
    },
    [client, documentId],
  );
  const reportError = useCallback(async (message: string) => {
    setError(message);
  }, []);
  const open = useCallback(
    async (selection: ReadingSelection, action: ReadingAction) => {
      if (!client || !document || selection.documentId !== documentId) return;
      const problem = selectionError(selection);
      if (problem) {
        setError(problem);
        return;
      }
      // DOM Range concatenates adjacent blocks without the paragraph separators
      // used by the article snapshot. Compare content, not that presentation gap.
      if (
        !document.text
          .replace(/\s+/g, "")
          .includes(selection.contextText.replace(/\s+/g, ""))
      ) {
        setError("正文已经更新，请重新选择词语。");
        return;
      }
      setCard({ id: ++sequence.current, selection, action });
    },
    [client, document, documentId],
  );

  useEffect(() => {
    setCard(undefined);
    setPanel(undefined);
  }, [document?.text]);

  return (
    <Context.Provider
      value={{
        enabled: !!client,
        tag: settings.tag,
        revision,
        documentId,
        error,
        lookup,
        phrases,
        open,
        publish,
        reportError,
        refresh,
        supported,
        ready: !!client && !!document?.text.trim(),
        showStudy: () => {
          if (client && document) setPanel("study");
        },
        showImport: () => {
          if (client && document) setPanel("import");
        },
      }}
    >
      {children}
      {client && document && panel === "study" && (
        <StudyPanel
          client={client}
          document={document}
          revision={revision}
          onClose={() => setPanel(undefined)}
          onChanged={refresh}
          onOpenWord={(selection) => {
            void open(selection, "lookup");
          }}
        />
      )}
      {client && document && panel === "import" && (
        <ImportPanel
          client={client}
          document={document}
          onClose={() => setPanel(undefined)}
        />
      )}
      {client && card && (
        <WordCard
          key={card.id}
          client={client}
          selection={card.selection}
          source={source}
          action={card.action}
          onClose={() => setCard(undefined)}
          onChanged={refresh}
        />
      )}
    </Context.Provider>
  );
}
