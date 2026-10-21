export { normalizeProduct } from "./normalize.js";

/**
 * A name to show until the agent names the product: the first four words of
 * the idea, first letter capitalised.
 */
export function placeholderName(idea: string): string {
  const words = idea.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
