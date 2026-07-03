/**
 * Derive the DEPLOY pane's follow target from a chat-session document.
 *
 * Unlike the preview track there is no explicit "show" tool — the agent deploys
 * by running its normal deploy commands. We treat the newest such command as
 * the intent to surface a project's deploy view, keyed by the tool call's id so
 * a later deploy navigates again:
 *
 *  - `reactor-project-publish` — its `name` arg is the project directory (==
 *    the studio project folder name), so it names the project directly. A
 *    publish with no `name` (the cwd project) can't be pinpointed and is
 *    skipped.
 *  - `deploy-environment-update` WITH `addPackage` — the go-live install. It
 *    names a package, not a project (mapped to a project downstream via the
 *    loaded package data), and is the ONLY deploy signal when an already-
 *    published package is installed without re-publishing.
 *
 * Other `deploy-environment-update` calls (rename, status transition, service
 * toggles) carry no package and are ignored. Keyed on the TOOL_CALL rather than
 * its result so we follow as the agent *starts* the step. Seeding per session
 * (so a deploy already in the transcript at load doesn't yank the view) lives
 * in the watcher via `deployFollowAction`.
 *
 * This module also exposes `useSessionDeployActivity` — a *refresh* signal
 * keyed on the newest completed deploy command (the TOOL_RESULT, not the call).
 * The DEPLOY view's install/release data is fetched once (no subscription), so
 * an agent deploy run from chat leaves it stale ("Not deployed here"); the view
 * re-fetches when this signal advances.
 *
 * Pure extraction (`extractDeployTarget` / `latestDeployResultId`) is exported
 * separately so it can be unit-tested without a React renderer — mirroring
 * `useSessionPreviewTarget`.
 */
import { useMemo } from "react";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";

const PUBLISH_TOOL = "reactor-project-publish";
const ENV_UPDATE_TOOL = "deploy-environment-update";

/** Deploy commands whose completion can change what the DEPLOY view shows:
 * publish → release/version, env-create → a new environment, env-update →
 * installed packages/services, env-wait → the settled (READY) state. Read-only
 * commands (publish-status, env-get/list) don't mutate and are excluded. */
const DEPLOY_RESULT_TOOLS: ReadonlySet<string> = new Set([
  PUBLISH_TOOL,
  "deploy-environment-create",
  ENV_UPDATE_TOOL,
  "deploy-environment-wait",
]);

export interface DeployTarget {
  /** Studio project (folder) name, when the signal names it directly. */
  project?: string;
  /** Package name (no version), when the signal is a package install. */
  packageName?: string;
  /** toolCallId of the deploy tool call — lets the watcher tell a NEW deploy
   * apart from the same one re-rendered. */
  callId: string;
}

interface PublishArgs {
  name?: string;
}

interface EnvUpdateArgs {
  addPackage?: string | string[];
}

export function useSessionDeployTarget(
  session: ChatSessionDocument | undefined,
): DeployTarget | undefined {
  return useMemo(() => extractDeployTarget(session), [session?.state]);
}

export function extractDeployTarget(
  session: ChatSessionDocument | undefined,
): DeployTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;

  // Walk backwards for the newest deploy TOOL_CALL we recognise.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_CALL") continue;
      if (!part.toolCallId) continue;

      if (part.toolName === PUBLISH_TOOL) {
        const args = safeParse<PublishArgs>(part.args);
        const project = args?.name?.trim();
        if (!project) continue; // cwd publish — no project to pinpoint
        return { project, callId: part.toolCallId };
      }

      if (part.toolName === ENV_UPDATE_TOOL) {
        const added = normalizeAddPackage(
          safeParse<EnvUpdateArgs>(part.args)?.addPackage,
        );
        if (added.length === 0) continue; // rename/transition/services — not a deploy
        return {
          packageName: stripPackageVersion(added[0]),
          callId: part.toolCallId,
        };
      }
    }
  }
  return undefined;
}

export function useSessionDeployActivity(
  session: ChatSessionDocument | undefined,
): string | null {
  return useMemo(() => latestDeployResultId(session), [session?.state]);
}

/**
 * The toolCallId of the newest non-error deploy command RESULT in the session,
 * or `null` if none. Identifies "a deploy step just finished" so a consumer can
 * re-fetch — a new id means new completed work. Pure; unit-tested.
 */
export function latestDeployResultId(
  session: ChatSessionDocument | undefined,
): string | null {
  if (!session) return null;
  const messages = session.state.global.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (part.isError) continue;
      if (!part.toolCallId) continue;
      if (!part.toolName || !DEPLOY_RESULT_TOOLS.has(part.toolName)) continue;
      return part.toolCallId;
    }
  }
  return null;
}

/** "name@version" → "name". A leading "@" (scoped pkg) is preserved; only the
 * version separator splits off. Mirrors `parsePackageSpec` in the CLI. */
function stripPackageVersion(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at <= 0 ? spec : spec.slice(0, at);
}

/** The addPackage arg is a comma-string or array (CLI `packageListSchema`
 * accepts both); normalise to trimmed, non-empty entries. */
function normalizeAddPackage(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
}

function safeParse<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
