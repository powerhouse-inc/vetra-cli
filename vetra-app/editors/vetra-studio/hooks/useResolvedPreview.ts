/**
 * Resolve a `PreviewTarget` → live state + URL, reactively.
 *
 *   1. On `target` change (or initial mount), fetch `/resolve`.
 *   2. Subscribe to the preview-server SSE stream. On any reactor-project
 *      event, refetch `/resolve` for the current target.
 *   3. When state is `project-stopped`, fire `POST /start` exactly once per
 *      target — the editor never asks the user; we treat opening a preview
 *      as intent to run the project.
 *   4. Aborts in-flight fetches when target changes or the component
 *      unmounts.
 *
 * Output mirrors the server's `ResolveResult` shape so the consuming
 * component renders the state machine directly.
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchResolve,
  fetchStart,
  subscribePreviewEvents,
  type ResolveResult,
} from "./preview-server-client.js";
import type { PreviewTarget } from "./useSessionPreviewTarget.js";

export type ResolvedPreview =
  | { kind: "no-target" }
  | { kind: "loading" }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "project-stopped"; project: string; projectPath: string }
  | { kind: "starting"; project: string; projectPath: string; driveId: string }
  | {
      kind: "ready";
      project: string;
      projectPath: string;
      driveId: string;
      documentId: string;
      url: string;
    }
  | { kind: "error"; message: string };

export function useResolvedPreview(
  target: PreviewTarget | undefined,
): ResolvedPreview {
  const [state, setState] = useState<ResolvedPreview>(
    target ? { kind: "loading" } : { kind: "no-target" },
  );

  /* Track which project we've already auto-started this lifecycle. Reset on
   * target.project change so a different session can start its own project,
   * and on `ready` so a future stop/start cycle within the same target
   * doesn't get suppressed. */
  const autoStartedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!target) {
      setState({ kind: "no-target" });
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    const refresh = async () => {
      try {
        const r: ResolveResult = await fetchResolve({
          project: target.project,
          doc: target.doc,
          signal: ac.signal,
        });
        if (cancelled) return;
        setState(r);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    setState({ kind: "loading" });
    void refresh();

    const unsubscribe = subscribePreviewEvents(() => {
      // Any reactor-project event → re-resolve. Cheap; same loopback hop.
      void refresh();
    });

    return () => {
      cancelled = true;
      ac.abort();
      unsubscribe();
    };
  }, [target?.project, target?.doc]);

  /* Auto-start: when we land on `project-stopped` for a target we haven't
   * started yet, fire POST /start. The server is idempotent and the SSE
   * stream will deliver the resulting service:starting / service:ready
   * events, which our refresh subscriber turns into state transitions. */
  useEffect(() => {
    if (!target) {
      autoStartedFor.current = undefined;
      return;
    }
    if (state.kind === "ready") {
      // Reset so a future stop can be auto-recovered.
      autoStartedFor.current = undefined;
      return;
    }
    if (state.kind !== "project-stopped") return;
    if (autoStartedFor.current === target.project) return;

    autoStartedFor.current = target.project;
    const ac = new AbortController();
    void fetchStart({ project: target.project, signal: ac.signal }).catch(
      () => {
        // Errors surface via the next /resolve; nothing to do here.
      },
    );
    return () => ac.abort();
  }, [state.kind, target?.project]);

  return state;
}
