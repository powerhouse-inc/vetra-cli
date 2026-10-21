/**
 * Words that must not reach the customer-facing story (Ruling F40b). The
 * progress tool refuses milestone, title, name and stuck text containing any
 * of them (case-insensitive) and asks the agent to rephrase, naming every
 * offending word at once.
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

/** Every forbidden word `text` contains, in list order (empty when none). */
export function findForbiddenWords(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.filter((word) => lower.includes(word.toLowerCase()));
}
