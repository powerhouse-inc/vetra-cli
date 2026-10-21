/**
 * Words the customer never sees on the Studio's main path (spec §4). They
 * may appear only in Settings › Advanced. Main-path component tests assert
 * their rendered output with `expectNoForbiddenWords`.
 */
import { expect } from "vitest";

export const FORBIDDEN_WORDS: readonly string[] = [
  "environment",
  "package",
  "registry",
  "Harbor",
  "image",
  "workflow",
  "device code",
  "approve changes",
  "switchboard",
];

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
}

/** The forbidden words found in `text` (whole words, plurals included). */
export function forbiddenWordsIn(text: string): string[] {
  return FORBIDDEN_WORDS.filter((word) =>
    new RegExp(`\\b${escape(word)}(s|es)?\\b`, "i").test(text),
  );
}

/** Text a customer can read in `container`: its text plus the labels,
 *  titles and placeholders of its elements. */
function readableText(container: HTMLElement): string {
  const parts = [container.textContent];
  for (const el of Array.from(container.querySelectorAll("*"))) {
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const value = el.getAttribute(attr);
      if (value) parts.push(value);
    }
  }
  return parts.join("\n");
}

/** Fails the test when `container` shows a forbidden word. */
export function expectNoForbiddenWords(container: HTMLElement): void {
  expect(forbiddenWordsIn(readableText(container))).toEqual([]);
}
