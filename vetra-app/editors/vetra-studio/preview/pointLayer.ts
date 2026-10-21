/**
 * The selection layer of "Point" mode (P4-M3): over a same-origin preview
 * frame it outlines the element under the cursor, selects on click and asks
 * to edit text on double-click. It works on the frame's own document (no
 * injected script) and touches nothing once detached: the click/dblclick
 * are only swallowed while attached, so the product keeps its own
 * interaction when Point is off.
 */
export interface PointHandlers {
  onSelect(el: Element): void;
  onEditText(el: Element): void;
  onExit(): void;
}

const OVERLAY_ATTR = "data-vetra-point-overlay";
const CAPTURE = { capture: true } as const;

/** The frame's document, or null when it is cross-origin or not loaded. */
export function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument?.body ? frame.contentDocument : null;
  } catch {
    return null;
  }
}

function attachToDocument(doc: Document, handlers: PointHandlers): () => void {
  const win = doc.defaultView;
  const overlay = doc.createElement("div");
  overlay.setAttribute(OVERLAY_ATTR, "");
  overlay.style.cssText =
    "position:absolute;pointer-events:none;display:none;box-sizing:border-box;" +
    "z-index:2147483647;border:2px solid #4f46e5;background:rgba(79,70,229,0.12);" +
    "border-radius:2px;";
  doc.body.appendChild(overlay);

  const targetOf = (e: Event): Element | null => {
    const t = e.target;
    if (!(t instanceof (win?.Element ?? Element))) return null;
    return t.closest(`[${OVERLAY_ATTR}]`) ? null : t;
  };

  const onMove = (e: Event) => {
    const el = targetOf(e);
    if (!el || el === doc.documentElement || el === doc.body) {
      overlay.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    overlay.style.left = `${r.left + (win?.scrollX ?? 0)}px`;
    overlay.style.top = `${r.top + (win?.scrollY ?? 0)}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
    overlay.style.display = "block";
  };
  const onLeave = () => {
    overlay.style.display = "none";
  };
  const swallow =
    (call: (el: Element) => void) =>
    (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = targetOf(e);
      if (el) call(el);
    };
  const onClick = swallow((el) => handlers.onSelect(el));
  const onDblClick = swallow((el) => handlers.onEditText(el));
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") handlers.onExit();
  };

  doc.addEventListener("mousemove", onMove, CAPTURE);
  doc.addEventListener("mouseleave", onLeave, CAPTURE);
  doc.addEventListener("click", onClick, CAPTURE);
  doc.addEventListener("dblclick", onDblClick, CAPTURE);
  doc.addEventListener("keydown", onKey, CAPTURE);

  return () => {
    doc.removeEventListener("mousemove", onMove, CAPTURE);
    doc.removeEventListener("mouseleave", onLeave, CAPTURE);
    doc.removeEventListener("click", onClick, CAPTURE);
    doc.removeEventListener("dblclick", onDblClick, CAPTURE);
    doc.removeEventListener("keydown", onKey, CAPTURE);
    overlay.remove();
  };
}

/**
 * Attaches Point mode to a frame; returns `detach`. Re-attaches when the
 * frame navigates (`load`). A cross-origin frame gets a no-op detach and
 * `onExit()`.
 */
export function attachPointLayer(
  frame: HTMLIFrameElement,
  handlers: PointHandlers,
): () => void {
  const first = frameDocument(frame);
  if (!first) {
    handlers.onExit();
    return () => {};
  }
  let detachDoc = attachToDocument(first, handlers);
  let done = false;
  const onLoad = () => {
    detachDoc();
    const doc = frameDocument(frame);
    if (doc) {
      detachDoc = attachToDocument(doc, handlers);
    } else {
      detachDoc = () => {};
      handlers.onExit();
    }
  };
  frame.addEventListener("load", onLoad);
  return () => {
    if (done) return;
    done = true;
    frame.removeEventListener("load", onLoad);
    detachDoc();
  };
}
