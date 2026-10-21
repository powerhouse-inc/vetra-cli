/**
 * Which language a browser shows: the override from the account menu, else
 * the browser's own languages. Pure TS, no React: browser code that is not a
 * component (agent messages) uses `languageHint` from here.
 */
import { de } from "./messages.de.js";
import { en, type MessageKey } from "./messages.en.js";

export type Language = "en" | "de";
export const LANGUAGE_KEY = "vetra-studio:language";

export function asLanguage(value: unknown): Language {
  return value === "de" ? "de" : "en";
}

export function detectLanguage(languages: readonly string[]): Language {
  return languages.some((l) => l.toLowerCase().startsWith("de")) ? "de" : "en";
}

export function readLanguageOverride(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === "de" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

export function writeLanguageOverride(lang: Language | null): void {
  try {
    if (lang === null) localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Storage is blocked: the choice lasts for this page only.
  }
}

export function currentLanguage(): Language {
  const override = readLanguageOverride();
  if (override) return override;
  const languages =
    typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
  return detectLanguage(languages);
}

type Catalogue = Partial<Record<MessageKey, string>>;

export function translate(
  lang: Language,
  key: MessageKey,
  vars?: Record<string, string | number>,
  catalogues: { en: Catalogue; de: Catalogue } = { en, de },
): string {
  const localized = lang === "de" ? catalogues.de[key] : catalogues.en[key];
  const template = localized || catalogues.en[key] || "";
  return template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    String(vars?.[name] ?? ""),
  );
}

export function languageHint(lang: Language): string {
  return lang === "de"
    ? "\n\n[Studio language: German — write story lines, outcomes and questions for the customer in German.]"
    : "";
}
