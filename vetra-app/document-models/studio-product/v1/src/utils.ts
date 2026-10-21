export { normalizeProduct } from "./normalize.js";
export {
  SUGGESTION_TEXT_MAX,
  SUGGESTIONS_MAX,
  SUGGESTIONS_MIN,
  currentSuggestions,
} from "./suggestions.js";

/**
 * A name to show until the agent names the product: the first four words of
 * the idea, first letter capitalised.
 */
export function placeholderName(idea: string): string {
  const words = idea.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export { BRING_IN_REQUEST, isBringIn } from "./github.js";
