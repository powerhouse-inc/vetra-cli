// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANGUAGE_KEY,
  asLanguage,
  currentLanguage,
  detectLanguage,
  languageHint,
  translate,
  writeLanguageOverride,
} from "./language.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("language", () => {
  it("detects German from de-AT", () => {
    expect(detectLanguage(["de-AT", "en"])).toBe("de");
  });
  it("the first supported language decides", () => {
    expect(detectLanguage(["en-US", "de"])).toBe("en");
    expect(detectLanguage(["fr-FR", "de-AT"])).toBe("de");
    expect(detectLanguage(["den"])).toBe("en");
  });
  it("defaults to English for fr-FR", () => {
    expect(detectLanguage(["fr-FR"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
  it("override wins over the browser", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    expect(currentLanguage()).toBe("de");
    writeLanguageOverride("en");
    expect(window.localStorage.getItem(LANGUAGE_KEY)).toBe("en");
    expect(currentLanguage()).toBe("en");
    writeLanguageOverride(null);
    expect(currentLanguage()).toBe("de");
  });
  it("blocked storage falls back to the browser language", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de"]);
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    });
    expect(() => writeLanguageOverride("en")).not.toThrow();
    expect(currentLanguage()).toBe("de");
  });
  it("missing German string falls back to English, never the key", () => {
    const catalogues = {
      en: { "idea.heading": "Hello" },
      de: { "idea.heading": "" },
    };
    expect(translate("de", "idea.heading", undefined, catalogues)).toBe(
      "Hello",
    );
    expect(translate("de", "idea.build", undefined, { en: {}, de: {} })).toBe(
      "",
    );
  });
  it("placeholders are filled", () => {
    expect(translate("en", "idea.spend", { amount: "$5" })).toBe("$5 to spend");
    expect(translate("de", "idea.spend")).toBe(" verfügbar");
  });
  it("asLanguage maps unknown to en", () => {
    expect(asLanguage("de")).toBe("de");
    expect(asLanguage("xx")).toBe("en");
    expect(asLanguage(undefined)).toBe("en");
  });
  it("languageHint is empty for English", () => {
    expect(languageHint("en")).toBe("");
    expect(languageHint("de")).toContain("German");
  });
});
