/**
 * What the agent gets about a pointed element (P4-M3, Task 3.2): the element's
 * text, the markers the generated code carries (`data-vetra-component`,
 * `data-vetra-field`), the screen it is on, and a readable path and rect. Pure;
 * the caller passes the preview's current screen. `pointContextText` turns the
 * result into the `[Pointed at]` block appended to the customer's request.
 */
import type { PreviewScreen } from "./previewTabs.js";
import { screenLabel } from "./previewTabs.js";

export interface PointTarget {
  text: string;
  tag: string;
  role: string | null;
  label: string | null;
  path: string[];
  rect: { x: number; y: number; width: number; height: number };
  component: string | null;
  field: string | null;
  module: string | null;
  document: { type: string; id: string } | null;
}

const MAX_TEXT = 200;
const MAX_PATH = 5;

function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name);
  return value && value.trim() ? value.trim() : null;
}

/** The value of `name` on the element or its nearest ancestor. */
function nearest(el: Element, name: string): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = attr(node, name);
    if (value) return value;
  }
  return null;
}

/** `tag`, then its component marker, id or first class when it has one. */
function pathSegment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const component = attr(el, "data-vetra-component");
  if (component) return `${tag}.${component.split(/\s+/)[0]}`;
  if (el.id) return `${tag}#${el.id}`;
  const first = el.classList[0];
  return first ? `${tag}.${first}` : tag;
}

/** The element and up to four ancestors, outermost first; never body/html. */
function pathOf(el: Element): string[] {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node === doc.body || node === doc.documentElement) break;
    parts.unshift(pathSegment(node));
    if (parts.length === MAX_PATH) break;
  }
  return parts;
}

/** The codegen module of an editor ("order-editor"); apps have none. */
function moduleOf(screen: PreviewScreen | null): string | null {
  if (!screen || screen.kind !== "editor") return null;
  return screenLabel(screen).toLowerCase().replace(/\s+/g, "-");
}

/** The document an editor shows: its first type and the screen's document. */
function documentOf(screen: PreviewScreen | null): PointTarget["document"] {
  if (!screen || screen.kind !== "editor") return null;
  return {
    type: screen.documentTypes.length > 0 ? screen.documentTypes[0] : "unknown",
    id: screen.id,
  };
}

/** Everything the agent should know about the element the customer pointed at. */
export function describeElement(
  el: Element,
  context: { screen: PreviewScreen | null },
): PointTarget {
  const rect = el.getBoundingClientRect();
  return {
    text: el.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT),
    tag: el.tagName.toLowerCase(),
    role: attr(el, "role"),
    label: attr(el, "aria-label"),
    path: pathOf(el),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    component: nearest(el, "data-vetra-component"),
    field: nearest(el, "data-vetra-field"),
    module: moduleOf(context.screen),
    document: documentOf(context.screen),
  };
}

/**
 * The block appended to the customer's request, in the plan's exact shape:
 *
 * ```
 * [Pointed at] <tag> "<text>"
 * Component: <component|unknown> · Field: <field|unknown>
 * Screen: <module|unknown> · Document: <type> <id>
 * Where: <path joined with " › "> · <width>×<height> at <x>,<y>
 * ```
 */
export function pointContextText(target: PointTarget): string {
  const document = target.document
    ? `${target.document.type} ${target.document.id}`
    : "unknown";
  const where = target.path.join(" › ") || target.tag;
  const { x, y, width, height } = target.rect;
  return [
    `[Pointed at] ${target.tag} "${target.text}"`,
    `Component: ${target.component ?? "unknown"} · Field: ${target.field ?? "unknown"}`,
    `Screen: ${target.module ?? "unknown"} · Document: ${document}`,
    `Where: ${where} · ${Math.round(width)}×${Math.round(height)} at ${Math.round(x)},${Math.round(y)}`,
  ].join("\n");
}
