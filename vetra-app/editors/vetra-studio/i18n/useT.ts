import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  currentLanguage,
  translate,
  writeLanguageOverride,
  type Language,
} from "./language.js";
import type { MessageKey } from "./messages.en.js";

/** One module store: every mounted component follows the same language. */
let language: Language | null = null;
const listeners = new Set<() => void>();

function getLanguage(): Language {
  language ??= currentLanguage();
  return language;
}

function applyToDocument(lang: Language): void {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(lang: Language | null): void {
  writeLanguageOverride(lang);
  language = lang ?? currentLanguage();
  applyToDocument(language);
  for (const l of [...listeners]) l();
}

/** Forget the cached language so the next read re-detects (tests). */
export function resetLanguageStore(): void {
  language = null;
}

export function useT(): {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  language: Language;
  setLanguage: (lang: Language | null) => void;
} {
  const lang = useSyncExternalStore(
    subscribe,
    getLanguage,
    (): Language => "en",
  );
  useEffect(() => applyToDocument(lang), [lang]);
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(lang, key, vars),
    [lang],
  );
  return { t, language: lang, setLanguage };
}
