import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import {
  SettingsGroup,
  SettingsScreen,
  SettingsToggleRow,
} from "@/components/settings/settings-list";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { EnglishCDClient } from "@/lib/englishcd/client";
import { useEnglishCDSettings } from "@/lib/englishcd/settings";
import type { EnglishCDSettings } from "@/lib/englishcd/types";

export default function EnglishCDSettingsPage() {
  const {
    settings,
    isLoading,
    error: storageError,
    setSettings,
  } = useEnglishCDSettings();
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const client = useRef<EnglishCDClient | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.current?.close();
    };
  }, []);

  const edit = (update: Partial<EnglishCDSettings>) => {
    setDraft((previous) => ({ ...previous, ...update }));
    setMessage("");
    setError("");
    if (update.url !== undefined || update.apiKey !== undefined) setTags([]);
  };

  async function test() {
    if (busy || isLoading) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      client.current?.close();
      const connection = new EnglishCDClient(draft);
      client.current = connection;
      const capabilities = await connection.capabilities();
      if (!alive.current) return;
      setTags(capabilities.dictionary?.tags ?? []);
      setMessage(
        `连接成功 · ${capabilities.translation?.enabled ? "AI 查词已启用" : "AI 查词未启用"}`,
      );
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "连接失败");
    } finally {
      client.current?.close();
      client.current = null;
      if (alive.current) setBusy(false);
    }
  }

  async function save() {
    if (busy || isLoading) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await setSettings(draft);
      if (alive.current) setMessage("EnglishCD 设置已保存");
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <SettingsScreen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "EnglishCD 英语学习" }} />
      <SettingsGroup footer="用于网页书签的阅读模式。普通阅读和本文词表不会把全文保存到 EnglishCD。">
        <SettingsToggleRow
          label="启用英语学习"
          disabled={busy || isLoading}
          value={draft.enabled}
          onValueChange={(enabled) => edit({ enabled })}
        />
      </SettingsGroup>
      <SettingsGroup
        header="独立连接"
        footer="填写 EnglishCD 根地址，可含部署子路径。此 Token 与 Karakeep API Key 分开保存。"
      >
        <View className="gap-4 px-4 py-2">
          <Input
            label="EnglishCD 地址"
            value={draft.url}
            onChangeText={(url) => edit({ url })}
            placeholder="http://server:8080"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy && !isLoading}
          />
          <Input
            label="EnglishCD API Token"
            value={draft.apiKey}
            onChangeText={(apiKey) => edit({ apiKey })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            editable={!busy && !isLoading}
          />
          <Button
            variant="secondary"
            onPress={() => void test()}
            disabled={busy || isLoading}
          >
            <Text>{busy ? "处理中…" : "测试连接"}</Text>
          </Button>
        </View>
      </SettingsGroup>
      <SettingsGroup
        header="高亮词典标签"
        footer="空白为全部。仅使用词典实际标签；已收藏短语按自身状态显示。"
      >
        <View className="gap-3 px-4 py-2">
          <Input
            label="标签"
            value={draft.tag}
            onChangeText={(tag) => edit({ tag })}
            placeholder="例如 cet4、b1"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy && !isLoading}
          />
          {tags.length > 0 && (
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant={draft.tag === "" ? "primary" : "tonal"}
                onPress={() => edit({ tag: "" })}
                disabled={busy}
              >
                <Text>全部</Text>
              </Button>
              {tags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant={
                    draft.tag.toLowerCase() === tag ? "primary" : "tonal"
                  }
                  onPress={() => edit({ tag })}
                  disabled={busy}
                >
                  <Text>{tag.toUpperCase()}</Text>
                </Button>
              ))}
            </View>
          )}
        </View>
      </SettingsGroup>
      {!!(error || storageError) && (
        <Text className="text-destructive" accessibilityRole="alert">
          {error || storageError}
        </Text>
      )}
      {!!message && <Text>{message}</Text>}
      <Button onPress={() => void save()} disabled={busy || isLoading}>
        <Text>{isLoading ? "读取设置…" : "保存设置"}</Text>
      </Button>
    </SettingsScreen>
  );
}
