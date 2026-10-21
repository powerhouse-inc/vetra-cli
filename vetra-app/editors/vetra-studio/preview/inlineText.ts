/**
 * In-place text editing inside the preview (P4-M3, Task 3.5): a text-only
 * element becomes `contenteditable="plaintext-only"`; Enter commits, Esc or
 * blur cancels, and the element's text and attribute state are always put
 * back (the caller applies the change, then the preview shows it).
 */
export function startInlineEdit(
  el: HTMLElement,
  onDone: (newText: string | null) => void,
): boolean {
  if (el.children.length > 0 || !el.textContent.trim()) return false;
  const originalText = el.textContent;
  const originalAttr = el.getAttribute("contenteditable");
  let done = false;

  const restore = () => {
    if (originalAttr === null) el.removeAttribute("contenteditable");
    else el.setAttribute("contenteditable", originalAttr);
    el.textContent = originalText;
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
  };
  const finish = (newText: string | null) => {
    if (done) return;
    done = true;
    restore();
    onDone(newText);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const next = el.textContent.trim();
      finish(next || null);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
    }
  };
  const onBlur = () => finish(null);

  el.setAttribute("contenteditable", "plaintext-only");
  el.focus();
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
  return true;
}
