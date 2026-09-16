import { useEffect } from "react";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import { normalizeConnection } from "./client";
import type { EnglishCDSettings } from "./types";

const STORAGE_KEY = "englishcd.settings.v1";

export const defaultEnglishCDSettings: EnglishCDSettings = {
  enabled: false,
  url: "",
  apiKey: "",
  tag: "",
};

function parseSettings(input: unknown): EnglishCDSettings {
  if (!input || typeof input !== "object")
    throw new Error("EnglishCD 设置无效");
  const value = input as Partial<EnglishCDSettings>;
  if (
    (value.enabled !== undefined && typeof value.enabled !== "boolean") ||
    [value.url, value.apiKey, value.tag].some(
      (field) => field !== undefined && typeof field !== "string",
    )
  ) {
    throw new Error("EnglishCD 设置无效");
  }
  return {
    enabled: value.enabled ?? false,
    url: value.url ?? "",
    apiKey: value.apiKey ?? "",
    tag: value.tag ?? "",
  };
}

export function normalizeSettings(
  settings: EnglishCDSettings,
): EnglishCDSettings {
  const value = parseSettings(settings);
  const connection =
    value.enabled || (value.url.trim() && value.apiKey.trim())
      ? normalizeConnection(value)
      : { url: value.url.trim(), apiKey: value.apiKey.trim() };
  return { ...value, ...connection, tag: value.tag.trim().toLowerCase() };
}

interface EnglishCDSettingsState {
  settings: EnglishCDSettings;
  isLoading: boolean;
  error: string;
  load: () => Promise<void>;
  setSettings: (settings: EnglishCDSettings) => Promise<void>;
}

let loading: Promise<void> | undefined;
let saving = Promise.resolve();
let revision = 0;

// Deliberately separate from the Karakeep account store and query persistence.
export const useEnglishCDStore = create<EnglishCDSettingsState>((set, get) => ({
  settings: { ...defaultEnglishCDSettings },
  isLoading: true,
  error: "",
  load: () => {
    if (loading) return loading;
    if (!get().isLoading) return Promise.resolve();
    const generation = revision;
    loading = (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        const settings = stored
          ? normalizeSettings(parseSettings(JSON.parse(stored)))
          : { ...defaultEnglishCDSettings };
        if (generation === revision)
          set({ settings, isLoading: false, error: "" });
      } catch {
        if (generation === revision) {
          set({
            isLoading: false,
            error: "EnglishCD 设置读取失败，请重新填写并保存",
          });
        }
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  },
  setSettings: async (settings) => {
    const value = normalizeSettings(settings);
    const generation = ++revision;
    const operation = saving
      .catch(() => undefined)
      .then(async () => {
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
        if (generation === revision)
          set({ settings: value, isLoading: false, error: "" });
      });
    saving = operation;
    try {
      await operation;
    } catch {
      if (generation === revision)
        set({ isLoading: false, error: "EnglishCD 设置保存失败，请手动重试" });
      throw new Error("EnglishCD 设置保存失败，请手动重试");
    }
  },
}));

export function useEnglishCDSettings() {
  const state = useEnglishCDStore();
  useEffect(() => {
    void state.load();
  }, [state.load]);
  return state;
}
