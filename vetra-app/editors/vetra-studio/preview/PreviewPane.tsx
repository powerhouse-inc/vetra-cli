/**
 * The preview pane of the build (spec §5.1, §5.4): the screen the agent is
 * working on, with a tab per editor and app under it. It follows the agent
 * until the customer picks a tab; then the chip "Following you · Back to the
 * build" returns to following. Before the agent shares a screen, it shows the
 * started project's Connect drive view as soon as the project is up. The picked tab survives reloads of the
 * preview, and `restartPreview()` restarts it (ruling F51: the button lives
 * with the failure line, Task 1.8).
 */
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import type { PHDocument } from "document-model";
import type { Change } from "document-models/studio-product";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PreviewBody, STARTING } from "../BuildSection.js";
import { fetchRestart, fetchStart } from "../hooks/preview-server-client.js";
import { ChangeThis } from "./ChangeThis.js";
import { describeElement, type PointTarget } from "./pointTarget.js";
import { pointShot } from "./pointShot.js";
import {
  useResolvedPreview,
  type ResolvedPreview,
} from "../hooks/useResolvedPreview.js";
import {
  useProjectHomeTarget,
  useSessionPreviewTarget,
} from "../hooks/useSessionPreviewTarget.js";
import { frameDocument } from "./pointLayer.js";
import { usePointMode } from "./usePointMode.js";
import {
  previewScreens,
  previewTabs,
  screenPreviews,
  tabForTarget,
  type PreviewTab,
} from "./previewTabs.js";

export const FOLLOWING_CHIP = "Following you · Back to the build";

/* ---------- restart ---------- */

/** The project the mounted pane shows (one pane per page). */
let shownProject: string | null = null;
let reloads = 0;
const reloadListeners = new Set<() => void>();

function subscribeReloads(listener: () => void): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

function reloadCount(): number {
  return reloads;
}

/**
 * Restarts the preview: stops the shown project and starts it again (also
 * when it is stuck starting), then reloads the frame. On an older Studio
 * without `/restart` it asks for a start instead. Rejects when the preview
 * can't be reached or the restart isn't allowed ("Couldn't restart the
 * preview."); the frame reloads either way.
 */
export async function restartPreview(): Promise<void> {
  const project = shownProject;
  try {
    if (project) {
      const restarted = await fetchRestart({ project });
      // Older Studios have no /restart: start (a stopped project comes back).
      if (restarted === null) await fetchStart({ project });
    }
  } finally {
    reloads += 1;
    for (const listener of reloadListeners) listener();
  }
}

/* ---------- pane ---------- */

function TabBar({
  tabs,
  selected,
  onSelect,
}: {
  tabs: PreviewTab[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Screens"
      className="flex shrink-0 flex-wrap gap-1.5 border-t border-border bg-card px-4 py-2"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === selected}
          data-tab={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            tab.id === selected
              ? "border-vetra-primary bg-vetra-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {tab.label}
          {tab.building ? (
            <span className="ml-1 text-muted-foreground">· building…</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function PreviewPane({
  change,
  documents,
  session,
  onPointRequest,
}: {
  /** The change being built (its Editors step marks the tab in progress). */
  change: Change | null;
  /** The drive's documents; the editor and app specs become tabs. */
  documents: readonly PHDocument[];
  /** The build's conversation, which says what the agent shows and edits. */
  session: ChatSessionDocument | undefined;
  /** Sends a pointed request; when absent Point still selects but cannot send. */
  onPointRequest?: (args: {
    request: string;
    target: PointTarget;
    shot: Blob | null;
  }) => Promise<void>;
}) {
  const screens = useMemo(() => previewScreens(documents), [documents]);
  const messages = session?.state.global.messages;
  const { targets, activeScreenId } = useMemo(
    () => screenPreviews(messages ?? [], screens),
    [messages, screens],
  );
  const agentTarget = useSessionPreviewTarget(session);
  const projectHome = useProjectHomeTarget(session);
  const tabs = previewTabs({
    screens,
    editorsStep: change?.steps.find((s) => s.kind === "EDITORS") ?? null,
    activeScreenId,
  });

  // The tab the customer picked; null while following the agent.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedTab = tabs.find((t) => t.id === picked) ?? null;
  const following = pickedTab === null;
  const target = following
    ? agentTarget
    : (targets.get(pickedTab.id) ?? undefined);
  // Following: the tab of the agent's preview, or the screen it is on
  // while it has nothing to show yet.
  const selected = following
    ? (tabForTarget(targets, agentTarget) ??
      (agentTarget ? null : activeScreenId))
    : pickedTab.id;
  const shownTab = tabs.find((t) => t.id === selected) ?? null;

  // Until the agent shares a screen, the started project's Connect drive
  // view — but only once it is up: otherwise the pane keeps its skeleton.
  const home = following && !agentTarget ? projectHome : undefined;
  const resolved = useResolvedPreview(target ?? home, {
    autoStart: target !== undefined,
  });
  const preview: ResolvedPreview =
    !target && home && resolved.kind !== "ready"
      ? { kind: "no-target" }
      : resolved;
  const reloadKey = useSyncExternalStore(subscribeReloads, reloadCount);

  const project =
    (target ?? (preview.kind === "ready" ? home : undefined))?.project ?? null;
  useEffect(() => {
    shownProject = project;
    return () => {
      if (shownProject === project) shownProject = null;
    };
  }, [project]);

  // Point mode: offered only while a same-origin frame is showing.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameLoads, setFrameLoads] = useState(0);
  const point = usePointMode(frameRef, `${frameLoads}`);
  // The clicked element, its rect moved into the pane's coordinates, and
  // its screenshot once html-to-image has rendered it.
  const paneRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<{
    target: PointTarget;
    shot: Blob | null;
  } | null>(null);
  const selectedElement = point.selected;

  useEffect(() => {
    if (!selectedElement) return;
    const screen = screens.find((s) => s.id === selected) ?? null;
    const target = describeElement(selectedElement, { screen });
    const frame = frameRef.current;
    const pane = paneRef.current;
    const frameBox = frame?.getBoundingClientRect();
    const paneBox = pane?.getBoundingClientRect();
    if (frameBox && paneBox) {
      target.rect = {
        ...target.rect,
        x: target.rect.x + frameBox.left - paneBox.left,
        y: target.rect.y + frameBox.top - paneBox.top,
      };
    }
    setPointed({ target, shot: null });
    let live = true;
    if (frame) {
      void pointShot(frame, selectedElement).then((shot) => {
        if (live) {
          setPointed((current) => (current ? { ...current, shot } : current));
        }
      });
    }
    return () => {
      live = false;
    };
  }, [selectedElement, selected, screens]);

  useEffect(() => {
    if (!point.active) setPointed(null);
  }, [point.active]);

  const sendPoint = async (text: string) => {
    if (!pointed || !onPointRequest) return;
    await onPointRequest({
      request: text,
      target: pointed.target,
      shot: pointed.shot,
    });
    point.clear();
    setPointed(null);
  };

  const canPoint =
    preview.kind === "ready" &&
    (frameRef.current === null || frameDocument(frameRef.current) !== null);

  const building = shownTab?.building
    ? `${shownTab.label} — building…`
    : undefined;

  return (
    <div ref={paneRef} className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          Live preview · updates as it builds
        </span>
        {canPoint ? (
          <button
            type="button"
            aria-pressed={point.active}
            onClick={point.toggle}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              point.active
                ? "border-vetra-primary bg-vetra-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            Point
          </button>
        ) : null}
        {following ? null : (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            {FOLLOWING_CHIP}
          </button>
        )}
      </div>
      <PreviewBody
        preview={preview}
        frameRef={frameRef}
        onFrameLoad={() => setFrameLoads((n) => n + 1)}
        reloadKey={reloadKey}
        activity={
          building ??
          // A picked screen with nothing to show yet in a project that exists.
          (!following && !target && (agentTarget || targets.size > 0)
            ? STARTING
            : undefined)
        }
        note={building}
      />
      {tabs.length > 0 ? (
        <TabBar tabs={tabs} selected={selected} onSelect={setPicked} />
      ) : null}
      {pointed && onPointRequest ? (
        <ChangeThis
          target={pointed.target}
          shot={pointed.shot}
          onSend={sendPoint}
          onCancel={() => {
            point.clear();
            setPointed(null);
          }}
        />
      ) : null}
    </div>
  );
}
