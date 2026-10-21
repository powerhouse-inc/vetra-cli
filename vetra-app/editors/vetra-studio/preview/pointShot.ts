/**
 * The screenshot attached to a pointed request (P4-M3, Task 3.2). It renders
 * the element's nearest ancestor large enough to show context (≥ 120×80 px),
 * capped at 1200 px wide, and never blocks the request: any failure is null.
 */
import { toBlob } from "html-to-image";

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const MAX_WIDTH = 1200;

/** The element itself, else its nearest ancestor at least 120×80 px. */
export function shotElement(el: Element): Element {
  const doc = el.ownerDocument;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node === doc.body || node === doc.documentElement) break;
    const rect = node.getBoundingClientRect();
    if (rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) return node;
  }
  return el;
}

/** A PNG of the pointed element's context, or null on any error. */
export async function pointShot(
  frame: HTMLIFrameElement,
  el: Element,
): Promise<Blob | null> {
  try {
    if (!frame.contentDocument?.contains(el)) return null;
    const node = shotElement(el);
    const rect = node.getBoundingClientRect();
    const scale = rect.width > MAX_WIDTH ? MAX_WIDTH / rect.width : 1;
    return await toBlob(node as HTMLElement, {
      width: rect.width,
      height: rect.height,
      canvasWidth: Math.round(rect.width * scale),
      canvasHeight: Math.round(rect.height * scale),
      pixelRatio: 1,
    });
  } catch {
    return null;
  }
}
