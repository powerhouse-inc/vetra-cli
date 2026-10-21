/**
 * Words that must not reach the customer-facing story (Ruling F40b). The
 * progress tool refuses milestone, title, name and stuck text containing any
 * of them (case-insensitive) and asks the agent to rephrase.
 */
export const FORBIDDEN_WORDS = [
  "environment",
  "package",
  "registry",
  "Harbor",
  "image",
  "workflow",
  "device code",
  "approve changes",
  "switchboard",
] as const;

/** The first forbidden word `text` contains, or null when it has none. */
export function findForbiddenWord(text: string): string | null {
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.find((word) => lower.includes(word.toLowerCase())) ?? null;
}
