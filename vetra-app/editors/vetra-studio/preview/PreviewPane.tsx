/**
 * The preview pane of the build (spec §5.1, §5.4): the screen the agent is
 * working on, with a tab per editor and app under it. It follows the agent
 * until the customer picks a tab; then the chip "Following you · Back to the
 * build" returns to following. The picked tab survives reloads of the
 * preview, and `restartPreview()` restarts it (ruling F51: the button lives
 * with the failure line, Task 1.8).
 */
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import type { PHDocument } from "document-model";
import type { Change } from "document-models/studio-product";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PreviewBody, STARTING } from "../BuildSection.js";
import { fetchRestart, fetchStart } from "../hooks/preview-server-client.js";
import { useResolvedPreview } from "../hooks/useResolvedPreview.js";
import { useSessionPreviewTarget } from "../hooks/useSessionPreviewTarget.js";
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
 * can't be reached; the frame reloads either way.
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
}: {
  /** The change being built (its Editors step marks the tab in progress). */
  change: Change | null;
  /** The drive's documents; the editor and app specs become tabs. */
  documents: readonly PHDocument[];
  /** The build's conversation, which says what the agent shows and edits. */
  session: ChatSessionDocument | undefined;
}) {
  const screens = useMemo(() => previewScreens(documents), [documents]);
  const messages = session?.state.global.messages;
  const { targets, activeScreenId } = useMemo(
    () => screenPreviews(messages ?? [], screens),
    [messages, screens],
  );
  const agentTarget = useSessionPreviewTarget(session);
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

  const preview = useResolvedPreview(target);
  const reloadKey = useSyncExternalStore(subscribeReloads, reloadCount);

  const project = target?.project ?? null;
  useEffect(() => {
    shownProject = project;
    return () => {
      if (shownProject === project) shownProject = null;
    };
  }, [project]);

  const building = shownTab?.building
    ? `${shownTab.label} — building…`
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          Live preview · updates as it builds
        </span>
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
    </div>
  );
}
