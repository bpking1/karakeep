import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import type { EnglishCDClient } from "@/lib/englishcd/client";
import {
  advancePractice,
  createInventory,
  filterWords,
  mergeInventory,
  ROUND_SIZE,
  selectedWords,
  tagLabel,
  toggleSelection,
  wordTags,
} from "@/lib/englishcd/study";
import type { StudyState, StudyWord } from "@/lib/englishcd/study";
import type {
  ReadingDocument,
  ReadingSelection,
  WordState,
} from "@/lib/englishcd/types";
import { wordStateLabels } from "@/lib/englishcd/word-card";
import { LearningModal } from "./LearningModal";

const states = (Object.keys(wordStateLabels) as WordState[]).map((value) => ({
  value,
  label: wordStateLabels[value],
}));

export function StudyPanel({
  client,
  document,
  revision,
  onClose,
  onChanged,
  onOpenWord,
}: {
  client: EnglishCDClient;
  document: ReadingDocument;
  revision: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenWord: (selection: ReadingSelection) => void;
}) {
  const [words, setWords] = useState<StudyWord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<StudyState>("unmastered");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [queue, setQueue] = useState<StudyWord[]>([]);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const inventory = createInventory(document);
        const infos = await client.lookup(inventory.inputs);
        if (current) setWords(mergeInventory(inventory, infos));
      } catch (error) {
        if (current)
          setError(error instanceof Error ? error.message : "读取本文词汇失败");
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [client, document, revision, retry]);

  const filtered = useMemo(
    () => filterWords(words, state, tag, query),
    [words, state, tag, query],
  );
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const word of words)
      for (const label of wordTags(word))
        counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [words]);
  const known = words.filter((word) => word.state === "known").length;

  const write = async (nextState?: WordState) => {
    if (busy.current || loading || !selected.size) return;
    busy.current = true;
    setWriting(true);
    setError("");
    setMessage("");
    const targets = selectedWords(words, selected);
    try {
      if (nextState) {
        await client.setStates(
          targets.map((word) => word.termKey),
          nextState,
        );
        if (alive.current) setMessage(`已更新 ${targets.length} 个词语`);
      } else {
        const result = await client.learning(
          targets.map((word) => word.termKey),
        );
        if (alive.current) {
          setQueue(targets);
          setPosition(0);
          setRevealed(false);
          setMessage(
            `加入学习 ${result.changed} 个；已掌握或忽略状态由服务器保留。练习不会自动标记掌握。`,
          );
        }
      }
      onChanged();
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : "更新词汇失败");
    } finally {
      busy.current = false;
      if (alive.current) setWriting(false);
    }
  };

  const active = queue[position];
  // Round boundaries are explicit; no automatic scheduling, AI, visit or mastery writes.
  const [pausedRound, setPausedRound] = useState(false);
  const next = () => {
    setRevealed(false);
    const step = advancePractice(position, queue.length);
    setPosition(step.position);
    setPausedRound(step.roundComplete);
  };

  return (
    <LearningModal title="本文词汇学习" onClose={onClose}>
      {error && (
        <View className="gap-2">
          <Text className="text-sm text-destructive">{error}</Text>
          <Button
            size="sm"
            variant="plain"
            disabled={loading || writing}
            onPress={() => {
              client.invalidate();
              setRetry((n) => n + 1);
            }}
          >
            <Text>重新读取词表</Text>
          </Button>
        </View>
      )}
      {message && (
        <Text className="text-sm text-muted-foreground">{message}</Text>
      )}
      {queue.length > 0 ? (
        <ScrollView
          style={{ flexShrink: 1 }}
          showsVerticalScrollIndicator={false}
        >
          {pausedRound || !active ? (
            <View className="gap-4 py-6">
              <Text className="text-lg">
                {pausedRound
                  ? `已完成本轮 ${ROUND_SIZE} 个词`
                  : `已完成 ${queue.length} 个词的回忆练习`}
              </Text>
              {pausedRound && (
                <Button onPress={() => setPausedRound(false)}>
                  <Text>继续下一轮（剩余 {queue.length - position} 个）</Text>
                </Button>
              )}
              <Button
                variant="tonal"
                onPress={() => {
                  setQueue([]);
                  setPausedRound(false);
                }}
              >
                <Text>返回词表</Text>
              </Button>
            </View>
          ) : (
            <View className="gap-4 py-3">
              <Text className="text-sm text-muted-foreground">
                {position + 1} / {queue.length} · 先回忆，再揭晓
              </Text>
              <Text className="text-3xl font-semibold">{active.termKey}</Text>
              {revealed ? (
                <>
                  {active.entry?.phonetic && (
                    <Text>{active.entry.phonetic}</Text>
                  )}
                  <Text>
                    {active.entry?.meanings
                      ?.map(
                        (item) =>
                          `${item.pos ? `${item.pos} ` : ""}${item.gloss}`,
                      )
                      .join("\n") || "词典暂无释义，可以打开词卡查词。"}
                  </Text>
                  <Text className="text-base text-muted-foreground">
                    {active.selection.contextText}
                  </Text>
                  <Button
                    variant="tonal"
                    onPress={() => onOpenWord(active.selection)}
                  >
                    <Text>打开单词卡片</Text>
                  </Button>
                </>
              ) : (
                <Button variant="tonal" onPress={() => setRevealed(true)}>
                  <Text>揭晓释义与原句</Text>
                </Button>
              )}
              <Button onPress={next}>
                <Text>
                  {position + 1 === queue.length ? "完成本轮" : "下一词"}
                </Text>
              </Button>
              <Button
                variant="plain"
                onPress={() => {
                  setQueue([]);
                  setPausedRound(false);
                }}
              >
                <Text>返回词表</Text>
              </Button>
            </View>
          )}
        </ScrollView>
      ) : (
        <>
          <Text className="text-sm text-muted-foreground">
            共 {words.length} 词 · 已掌握 {known} · 未掌握{" "}
            {words.length - known}
          </Text>
          <Input
            placeholder="搜索词语"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 6 }}
          >
            {[
              { value: "unmastered" as StudyState, label: "未掌握（含忽略）" },
              { value: "all" as StudyState, label: "全部" },
              ...states,
            ].map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant={state === item.value ? "tonal" : "plain"}
                onPress={() => setState(item.value)}
              >
                <Text>{item.label}</Text>
              </Button>
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 6 }}
          >
            <Button
              size="sm"
              variant={!tag ? "tonal" : "plain"}
              onPress={() => setTag("")}
            >
              <Text>全部标签</Text>
            </Button>
            {tags.map(([label, count]) => (
              <Button
                key={label}
                size="sm"
                variant={tag === label ? "tonal" : "plain"}
                onPress={() => setTag(label)}
              >
                <Text>
                  {tagLabel(label)} {count}
                </Text>
              </Button>
            ))}
          </ScrollView>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm">
              筛选 {filtered.length} · 已选 {selected.size}
            </Text>
            <Button
              size="sm"
              variant="plain"
              disabled={loading || writing}
              onPress={() =>
                setSelected((previous) =>
                  toggleSelection(
                    previous,
                    filtered.map((word) => word.termKey),
                  ),
                )
              }
            >
              <Text>全选 / 取消当前</Text>
            </Button>
            <Button
              size="sm"
              variant="plain"
              onPress={() => setSelected(new Set())}
            >
              <Text>清空</Text>
            </Button>
          </View>
          {loading && <ActivityIndicator />}
          <FlatList
            data={filtered}
            keyExtractor={(word) => word.termKey}
            style={{ flexShrink: 1, minHeight: 100 }}
            extraData={selected}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              !loading ? (
                <Text className="py-4 text-muted-foreground">
                  当前筛选没有词语
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected.has(item.termKey) }}
                disabled={writing}
                onPress={() =>
                  setSelected((previous) =>
                    toggleSelection(previous, [item.termKey]),
                  )
                }
                className={`flex-row items-center gap-3 rounded-xl px-3 py-3 ${selected.has(item.termKey) ? "bg-primary/10" : ""}`}
              >
                <Text className="text-primary">
                  {selected.has(item.termKey) ? "☑" : "□"}
                </Text>
                <View className="flex-1">
                  <Text className="font-medium">{item.termKey}</Text>
                  <Text
                    numberOfLines={1}
                    className="text-xs text-muted-foreground"
                  >
                    {wordTags(item).map(tagLabel).join(" · ")} ·{" "}
                    {states.find((s) => s.value === item.state)?.label}
                  </Text>
                </View>
                <Text className="text-sm text-muted-foreground">
                  {item.count} 次
                </Text>
              </Pressable>
            )}
          />
          <View className="flex-row flex-wrap gap-1">
            {states.map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant="tonal"
                disabled={!selected.size || writing || loading}
                onPress={() => void write(item.value)}
              >
                <Text>{item.label}</Text>
              </Button>
            ))}
          </View>
          <Button
            disabled={!selected.size || writing || loading}
            onPress={() => void write()}
          >
            <Text>
              {writing ? "正在保存…" : `学习所选 ${selected.size} 词`}
            </Text>
          </Button>
        </>
      )}
    </LearningModal>
  );
}
