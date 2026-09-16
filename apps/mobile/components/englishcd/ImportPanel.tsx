import { useEffect, useRef, useState } from "react";
import { Linking, ScrollView } from "react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import type { EnglishCDClient } from "@/lib/englishcd/client";
import { prepareImportAttempt } from "@/lib/englishcd/import-draft";
import type { ImportAttempt } from "@/lib/englishcd/import-draft";
import type { ImportResult, ReadingDocument } from "@/lib/englishcd/types";
import { LearningModal } from "./LearningModal";

export function ImportPanel({
  client,
  document,
  onClose,
}: {
  client: EnglishCDClient;
  document: ReadingDocument;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [text, setText] = useState(document.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult>();
  const alive = useRef(true);
  const writing = useRef(false);
  const attempt = useRef<ImportAttempt | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async () => {
    if (writing.current || result) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      attempt.current = prepareImportAttempt(
        attempt.current,
        document,
        title,
        text,
        () =>
          `karakeep-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      );
      const imported = await client.import(
        attempt.current.payload,
        attempt.current.key,
      );
      if (alive.current) setResult(imported);
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : "导入失败");
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <LearningModal title="导入英语" onClose={onClose}>
      <ScrollView
        style={{ flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 12 }}
      >
        {result ? (
          <>
            <Text className="text-lg">资料已导入</Text>
            <Text>{title}</Text>
            <Text className="text-sm text-muted-foreground">
              浏览器需要独立连接 EnglishCD，不会通过链接传递密钥。
            </Text>
            <Button
              onPress={() =>
                void Linking.openURL(client.libraryURL(result)).catch(
                  (error: unknown) => {
                    if (alive.current)
                      setError(
                        error instanceof Error
                          ? error.message
                          : "无法打开资料链接",
                      );
                  },
                )
              }
            >
              <Text>打开学习资料</Text>
            </Button>
          </>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground">
              确认后将把下面的完整正文长期保存到
              EnglishCD。服务器可能按已有配置自动生成 AI 总结并产生费用。
            </Text>
            <Text selectable className="text-xs text-muted-foreground">
              {document.source.url}
            </Text>
            <Input
              label="资料标题"
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              maxLength={500}
            />
            <Input
              label={`正文 · ${text.length} 字符`}
              multiline
              textAlignVertical="top"
              value={text}
              onChangeText={setText}
              editable={!busy}
              inputClasses="h-64"
              style={{ height: 256 }}
            />
            <Button
              disabled={busy || !text.trim() || !title.trim()}
              onPress={() => void submit()}
            >
              <Text>{busy ? "正在导入…" : "确认导入全文"}</Text>
            </Button>
            {busy && (
              <Text className="text-xs text-muted-foreground">
                关闭卡片不会撤销已发出的导入请求。
              </Text>
            )}
          </>
        )}
        {error && (
          <Text selectable className="text-sm text-destructive">
            {error}
          </Text>
        )}
      </ScrollView>
    </LearningModal>
  );
}
