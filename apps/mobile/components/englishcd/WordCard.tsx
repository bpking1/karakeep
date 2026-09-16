import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import type { EnglishCDClient } from "@/lib/englishcd/client";
import type {
  AIDictionaryEntry,
  ReadingSelection,
  Source,
  WordState,
} from "@/lib/englishcd/types";
import { WordCardSession, wordStateLabels } from "@/lib/englishcd/word-card";
import type { WordCardAction } from "@/lib/englishcd/word-card";

interface WordCardProps {
  client: EnglishCDClient;
  selection: ReadingSelection;
  source: Source;
  action: WordCardAction;
  onClose: () => void;
  onChanged: () => void;
}

function DictionaryResult({ entry }: { entry: AIDictionaryEntry }) {
  return (
    <View className="gap-3">
      {!!entry.headword && <Text variant="heading">{entry.headword}</Text>}
      {!!(entry.phonetic || entry.partOfSpeech) && (
        <Text color="secondary" variant="subhead">
          {[entry.phonetic, entry.partOfSpeech].filter(Boolean).join(" · ")}
        </Text>
      )}
      {!!entry.definition && <Text selectable>{entry.definition}</Text>}
      {!!entry.sentence && (
        <View className="gap-1 rounded-xl bg-muted p-3">
          <Text color="tertiary" variant="caption1">
            AI 引用原句
          </Text>
          <Text selectable>{entry.sentence}</Text>
          {!!entry.sentenceTranslation && (
            <Text selectable color="secondary">
              {entry.sentenceTranslation}
            </Text>
          )}
        </View>
      )}
      {!!entry.cefr && (
        <Text color="tertiary" variant="footnote">
          CEFR {entry.cefr} · AI 参考
        </Text>
      )}
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  return message ? (
    <Text selectable variant="footnote" className="text-destructive">
      {message}
    </Text>
  ) : null;
}

/** The caller gives each opening a new React key, including reopening the same word. */
export default function WordCard({
  client,
  selection,
  source,
  action,
  onClose,
  onChanged,
}: WordCardProps) {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [session] = useState(
    () =>
      new WordCardSession(client, selection, source, action, () =>
        changed.current(),
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    void session.initialize();
    return () => session.close();
  }, [session]);

  const close = () => {
    session.close();
    onClose();
  };
  const invalid = !!session.invalidSelection;
  const sentence = state.kind === "sentence";
  const translation = action === "translate" || sentence;
  const aiDisabled =
    invalid ||
    state.aiBusy ||
    !state.capabilitiesReady ||
    !state.translationEnabled ||
    !state.recordReady;
  const captureLabel = sentence
    ? "收藏选区"
    : state.kind === "phrase"
      ? "收藏短语"
      : "收藏单词";

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View
        className="flex-1 justify-center px-4"
        style={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Pressable
          className="absolute inset-0 bg-black/50"
          accessibilityLabel="关闭词语卡片"
          onPress={close}
        />
        <View className="max-h-[90%] overflow-hidden rounded-3xl bg-card">
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-5 p-5"
            keyboardShouldPersistTaps="handled"
          >
            <View className="gap-1">
              <Text color="tertiary" variant="caption1">
                {action === "capture"
                  ? "收藏预览"
                  : translation
                    ? "选区翻译"
                    : "EnglishCD 查词"}
              </Text>
              <Text selectable variant={sentence ? "heading" : "title1"}>
                {session.selection.selectedText}
              </Text>
              {!!state.word?.entry?.phonetic && (
                <Text color="secondary">{state.word.entry.phonetic}</Text>
              )}
              {!!state.word?.entry?.tags?.length && (
                <Text variant="footnote" color="tertiary">
                  {state.word.entry.tags.join(" · ")}
                </Text>
              )}
            </View>

            {action !== "translate" &&
              !/^[A-Za-z]+(?:['’ʼ-][A-Za-z]+)*$/.test(
                selection.selectedText,
              ) && (
                <View className="flex-row gap-2">
                  <Button
                    size="sm"
                    variant={state.kind === "phrase" ? "tonal" : "plain"}
                    disabled={state.aiBusy || state.writeBusy || invalid}
                    onPress={() => session.setKind("phrase")}
                  >
                    <Text>作为短语</Text>
                  </Button>
                  <Button
                    size="sm"
                    variant={sentence ? "tonal" : "plain"}
                    disabled={state.aiBusy || state.writeBusy || invalid}
                    onPress={() => session.setKind("sentence")}
                  >
                    <Text>作为句子</Text>
                  </Button>
                </View>
              )}

            {!sentence && (
              <View className="gap-2">
                <Text color="tertiary" variant="caption1">
                  掌握状态
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {(Object.keys(wordStateLabels) as WordState[]).map(
                    (value) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={
                          state.word?.state === value ? "tonal" : "plain"
                        }
                        accessibilityState={{
                          selected: state.word?.state === value,
                        }}
                        disabled={
                          state.writeBusy ||
                          invalid ||
                          !(selection.termKey || state.word?.termKey)
                        }
                        onPress={() => void session.mark(value)}
                      >
                        <Text>{wordStateLabels[value]}</Text>
                      </Button>
                    ),
                  )}
                </View>
                {!state.word && !!state.writeError && (
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={state.writeBusy}
                    onPress={() => void session.lookup()}
                  >
                    <Text>重试读取词典与状态</Text>
                  </Button>
                )}
              </View>
            )}

            {!!state.word?.entry?.meanings?.length && (
              <View className="gap-2">
                <Text color="tertiary" variant="caption1">
                  词典释义
                </Text>
                {state.word.entry.meanings.map((meaning, index) => (
                  <Text
                    selectable
                    key={`${index}-${meaning.pos ?? ""}`}
                    variant="subhead"
                  >
                    {meaning.pos ? `${meaning.pos} · ` : ""}
                    {meaning.gloss}
                  </Text>
                ))}
              </View>
            )}

            {session.selection.contextText !==
              session.selection.selectedText && (
              <View className="gap-2 rounded-xl bg-muted p-3">
                <Text color="tertiary" variant="caption1">
                  所在原句
                </Text>
                <Text selectable variant="subhead">
                  {session.selection.contextText}
                </Text>
              </View>
            )}

            <View className="flex-row flex-wrap gap-2">
              <Button
                variant="tonal"
                disabled={state.writeBusy || invalid}
                onPress={() => void session.capture()}
              >
                <Text>{captureLabel}</Text>
              </Button>
              {!sentence &&
                selection.contextText !== selection.selectedText && (
                  <Button
                    variant="plain"
                    disabled={state.writeBusy || invalid}
                    onPress={() => void session.capture(true)}
                  >
                    <Text>收藏原句</Text>
                  </Button>
                )}
            </View>
            {!!state.message && (
              <Text color="secondary" variant="footnote">
                {state.message}
              </Text>
            )}
            <ErrorText message={session.invalidSelection || state.writeError} />
            <ErrorText message={state.visitError} />

            <View className="gap-3 border-t border-border pt-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="heading">
                  {translation ? "翻译" : "AI 查词"}
                </Text>
                <View className="flex-row items-center gap-2">
                  {state.aiBusy && <ActivityIndicator size="small" />}
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={aiDisabled}
                    onPress={() => void session.generate()}
                  >
                    <Text>
                      {state.aiBusy
                        ? "读取中"
                        : state.result
                          ? "重新查询"
                          : translation
                            ? "翻译选区"
                            : "AI 查词"}
                    </Text>
                  </Button>
                </View>
              </View>
              {state.cached && (
                <Text color="tertiary" variant="caption1">
                  上次查词结果 · 可能来自不同语境
                </Text>
              )}
              {state.result?.dictionary ? (
                <DictionaryResult entry={state.result.dictionary} />
              ) : (
                !!state.result?.text && (
                  <Text selectable>{state.result.text}</Text>
                )
              )}
              {state.capabilitiesReady && !state.translationEnabled && (
                <Text color="tertiary" variant="footnote">
                  请先在 EnglishCD 服务器设置中启用 AI 翻译服务。
                </Text>
              )}
              <ErrorText message={state.aiError} />
              {!!state.recordError && (
                <View className="gap-2">
                  <ErrorText
                    message={`读取查词记录失败：${state.recordError}`}
                  />
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={state.aiBusy}
                    onPress={() => void session.readRecord()}
                  >
                    <Text>重试读取记录</Text>
                  </Button>
                </View>
              )}
              {!!state.capabilityError && (
                <View className="gap-2">
                  <ErrorText
                    message={`读取服务状态失败：${state.capabilityError}`}
                  />
                  <Button
                    size="sm"
                    variant="plain"
                    onPress={() => void session.readCapabilities()}
                  >
                    <Text>重试读取服务状态</Text>
                  </Button>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
