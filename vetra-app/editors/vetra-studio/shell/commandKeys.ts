/** Marks the command bar's own input, where the shortcut still toggles. */
export const COMMAND_INPUT_ATTR = "data-command-input";

/** Mac shows ⌘K; every other platform Ctrl-K. */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.hasAttribute(COMMAND_INPUT_ATTR)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable === true ||
    el.getAttribute("contenteditable") === "true"
  );
}

/**
 * ⌘K on mac, Ctrl-K elsewhere. Ignored while the customer types in one of
 * the page's own inputs (the product frame is a separate document, so its
 * inputs never reach this listener).
 */
export function isCommandShortcut(e: KeyboardEvent, platform: string): boolean {
  if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return false;
  const mac = isMacPlatform(platform);
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false;
  return !isEditable(e.target);
}
