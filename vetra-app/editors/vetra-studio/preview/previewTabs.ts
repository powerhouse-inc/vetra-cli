/**
 * The preview's tabs (spec §5.4): one per screen — each editor and the app —
 * as they become available, the one being built marked `building…`. Pure, so
 * the tab logic is testable without a renderer.
 *
 * Screens come from the drive's editor and app specs. Which preview each tab
 * opens, and which screen the agent is on, come from the conversation: the
 * sample documents the agent created (`spec-preview-create`), the previews it
 * showed (`spec-preview-show`), the specs it edited and the files it wrote.
 */
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import type { PHDocument } from "document-model";
import type { ProductStep } from "document-models/studio-product";
import type { PreviewTarget } from "../hooks/useSessionPreviewTarget.js";

export const EDITOR_SPEC_TYPE = "powerhouse/document-editor";
export const APP_SPEC_TYPE = "powerhouse/app";

export type ScreenKind = "editor" | "app";

/** One editor or app of the build. */
export interface PreviewScreen {
  id: string;
  kind: ScreenKind;
  /** The name as written in the spec ("OrderEditor", "Kitchen queue"). */
  name: string;
  /** Document types an editor edits (empty for an app). */
  documentTypes: string[];
  /** Confirmed specs have their code generated; drafts don't render yet. */
  confirmed: boolean;
}

export interface PreviewProject {
  screens: readonly PreviewScreen[];
  /** The change's Editors step; a tab is building only while it works. */
  editorsStep?: ProductStep | null;
  /** The screen the agent is working on now, when known. */
  activeScreenId?: string | null;
}

export interface PreviewTab {
  id: string;
  label: string;
  building: boolean;
}

type Messages = ChatSessionDocument["state"]["global"]["messages"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function parse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** The editor and app specs among the drive's documents, editors first. */
export function previewScreens(
  documents: readonly PHDocument[],
): PreviewScreen[] {
  const screens: PreviewScreen[] = [];
  for (const doc of documents) {
    const type = doc.header.documentType;
    if (type !== EDITOR_SPEC_TYPE && type !== APP_SPEC_TYPE) continue;
    const global = record(record(doc.state).global);
    const name = text(global.name) ?? text(doc.header.name) ?? "Screen";
    const documentTypes = Array.isArray(global.documentTypes)
      ? global.documentTypes
          .map((item) => text(record(item).documentType))
          .filter((t): t is string => t !== undefined)
      : [];
    screens.push({
      id: doc.header.id,
      kind: type === EDITOR_SPEC_TYPE ? "editor" : "app",
      name,
      documentTypes,
      confirmed: global.status === "CONFIRMED",
    });
  }
  return [
    ...screens.filter((s) => s.kind === "editor"),
    ...screens.filter((s) => s.kind === "app"),
  ];
}

/** Words of a name: "OrderEditor", "order-editor", "order_editor" → order, editor. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** A screen's name in plain words: "Order editor", "Kitchen queue". */
export function screenLabel(
  screen: Pick<PreviewScreen, "kind" | "name">,
): string {
  const parts = words(screen.name);
  if (parts.length === 0) return screen.kind === "app" ? "App" : "Editor";
  if (screen.kind === "editor" && parts.at(-1) !== "editor") {
    parts.push("editor");
  }
  const sentence = parts.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The folder name codegen gives a screen ("order-editor"). */
function folderOf(name: string): string {
  return words(name).join("-");
}

/**
 * The tabs under the preview: the screens whose code is generated, plus the
 * one being built. While the Editors step works, the screen the agent is on
 * — else the first one whose code isn't generated yet — is `building`.
 */
export function previewTabs(project: PreviewProject): PreviewTab[] {
  const { screens } = project;
  const working = project.editorsStep?.status === "WORKING";
  const building = !working
    ? null
    : (screens.find((s) => s.id === project.activeScreenId) ??
      screens.find((s) => !s.confirmed) ??
      null);
  // Tabs appear as screens become available: generated, or being built.
  return screens
    .filter((screen) => screen.confirmed || screen.id === building?.id)
    .map((screen) => ({
      id: screen.id,
      label: screenLabel(screen),
      building: building?.id === screen.id,
    }));
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string | null;
  isError: boolean;
}

/** Tool calls in order, each with its result once it arrived. */
function toolCalls(messages: Messages): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "TOOL_CALL" && part.toolCallId) {
        const call: ToolCall = {
          name: part.toolName ?? "",
          args: parse(part.args),
          result: null,
          isError: false,
        };
        calls.push(call);
        byId.set(part.toolCallId, call);
      } else if (part.type === "TOOL_RESULT" && part.toolCallId) {
        const call = byId.get(part.toolCallId);
        if (!call) continue;
        call.result = part.result ?? null;
        call.isError = part.isError === true;
      }
    }
  }
  return calls;
}

function sameName(a: string, b: string): boolean {
  return folderOf(a) === folderOf(b);
}

function appFor(
  screens: readonly PreviewScreen[],
  app: string | undefined,
): PreviewScreen | undefined {
  const apps = screens.filter((s) => s.kind === "app");
  if (app) {
    const named = apps.find((s) => s.id === app || sameName(s.name, app));
    if (named) return named;
  }
  return apps.length === 1 ? apps[0] : undefined;
}

/** The screen a file path belongs to (`…/editors/order-editor/…`). */
function screenForPath(
  screens: readonly PreviewScreen[],
  path: string,
): PreviewScreen | undefined {
  const match = /(?:^|\/)(editors|apps)\/([^/]+)\//.exec(path);
  if (!match) return undefined;
  const kind: ScreenKind = match[1] === "apps" ? "app" : "editor";
  const folder = match[2];
  // Codegen names the folder after the spec; allow an "-editor" suffix too.
  return screens.find(
    (s) =>
      s.kind === kind &&
      (folderOf(s.name) === folder || folderOf(screenLabel(s)) === folder),
  );
}

export interface ScreenPreviews {
  /** The preview each screen opens, for the screens that have one. */
  targets: Map<string, PreviewTarget>;
  /** The screen the agent worked on last, if any. */
  activeScreenId: string | null;
}

/**
 * Reads the conversation for each screen's preview and the screen the agent
 * is on. Only successful calls count.
 */
export function screenPreviews(
  messages: Messages,
  screens: readonly PreviewScreen[],
): ScreenPreviews {
  const targets = new Map<string, PreviewTarget>();
  /** Sample document (id or name) → its document type. */
  const sampleType = new Map<string, string>();
  let activeScreenId: string | null = null;
  const editorFor = (type: string | undefined) =>
    type
      ? screens.find(
          (s) => s.kind === "editor" && s.documentTypes.includes(type),
        )
      : undefined;

  let index = 0;
  for (const call of toolCalls(messages)) {
    index += 1;
    if (call.isError || call.result === null) continue;
    const project = text(call.args.project);
    const callId = `screen-${index}`;

    switch (call.name) {
      case "spec-preview-create": {
        const type = text(call.args.type);
        const name = text(call.args.name);
        if (!type || text(call.args.drive)) break;
        const id = /\bid: (\S+)/.exec(call.result)?.[1];
        if (name) sampleType.set(name, type);
        if (id) sampleType.set(id, type);
        const screen = editorFor(type);
        const doc = id ?? name;
        if (screen && project && doc && !targets.has(screen.id)) {
          targets.set(screen.id, { project, doc, callId });
        }
        break;
      }
      case "spec-preview-show": {
        if (!project) break;
        const data = record(parse(call.result).data);
        if (record(data).blocked === true) break;
        const drive = text(call.args.drive);
        if (drive) {
          const screen = appFor(screens, text(call.args.app));
          if (!screen) break;
          targets.set(screen.id, { project, drive, callId });
          activeScreenId = screen.id;
          break;
        }
        const id = text(data.documentId);
        const doc = text(data.documentSlug) ?? id;
        const name = text(call.args.name);
        const type =
          (id && sampleType.get(id)) ?? (name && sampleType.get(name));
        const screen = editorFor(type || undefined);
        if (!screen || !doc) break;
        targets.set(screen.id, { project, doc, callId });
        activeScreenId = screen.id;
        break;
      }
      case "spec-create":
      case "spec-update": {
        const id = text(record(parse(call.result).data).documentId);
        if (id && screens.some((s) => s.id === id)) activeScreenId = id;
        break;
      }
      default: {
        if (!call.name.startsWith("mastra_workspace_")) break;
        const path = text(call.args.file_path) ?? text(call.args.path);
        const screen = path ? screenForPath(screens, path) : undefined;
        if (screen) activeScreenId = screen.id;
      }
    }
  }
  return { targets, activeScreenId };
}

/** The tab a preview target belongs to (the agent's latest preview). */
export function tabForTarget(
  targets: ReadonlyMap<string, PreviewTarget>,
  target: PreviewTarget | undefined,
): string | null {
  if (!target) return null;
  for (const [screenId, t] of targets) {
    if (
      t.project === target.project &&
      (t.doc ?? null) === (target.doc ?? null) &&
      (t.drive ?? null) === (target.drive ?? null)
    ) {
      return screenId;
    }
  }
  return null;
}
