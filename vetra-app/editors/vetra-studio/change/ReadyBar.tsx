/**
 * The Ready bar over the preview (spec §5.7): once the change's checks pass,
 * **Ready to go live.** "<title>" · checks passed · [Make it live]
 * [Keep changing] [Discard]. Make it live writes `REQUEST_LAUNCH`; Discard
 * asks first and then writes `REQUEST_DISCARD` (F9) — the agent carries both
 * out. While the launch runs, the bar shows the launch lines of §5.5.
 */
import {
  actions as productActions,
  type Change,
  type LaunchLine,
  type StudioProductState,
} from "document-models/studio-product";
import { useState } from "react";
import { dispatchOrFail } from "../failures/FailureLine.js";
import { liveHost } from "../live/liveCopy.js";
import {
  CHECKS_PASSED,
  DISCARD,
  DISCARD_CONFIRM,
  DISCARD_NOT_REQUESTED,
  GOING_LIVE,
  KEEP_CHANGING,
  KEEP_IT,
  LAUNCH_NOT_REQUESTED,
  MAKE_IT_LIVE,
  READY_TO_GO_LIVE,
  THROWING_AWAY,
  THROW_IT_AWAY,
  changeTitle,
  launchLineText,
} from "./changeCopy.js";

const LINE_ICON: Record<LaunchLine["status"], string> = {
  WAITING: "○",
  RUNNING: "◐",
  DONE: "✓",
  FAILED: "✕",
  SKIPPED: "–",
};

const buttonClass =
  "rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50";

export function ReadyBar({
  product,
  productId,
  change,
  requestedBy,
  onKeepChanging,
}: {
  /** Normalised product state (`readProduct`). */
  product: StudioProductState;
  productId: string | null;
  /** The open change (READY or LAUNCHING shows the bar). */
  change: Change;
  /** Who asks, recorded on the request (the signed-in person). */
  requestedBy: string;
  /** Back to the conversation: another request joins the same change. */
  onKeepChanging: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<"LAUNCH" | "DISCARD" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (change.status === "LAUNCHING") {
    return <LaunchLines product={product} change={change} />;
  }
  if (change.status !== "READY") return null;

  const pending =
    product.pendingRequest?.changeId === change.id
      ? product.pendingRequest.kind
      : null;
  const waiting = sent ?? pending;
  const busy = waiting === "LAUNCH" || waiting === "DISCARD";

  function request(kind: "LAUNCH" | "DISCARD") {
    setError(null);
    setConfirming(false);
    setSent(kind);
    const requestedAt = new Date().toISOString();
    const action =
      kind === "LAUNCH"
        ? productActions.requestLaunch({
            changeId: change.id,
            requestedAt,
            requestedBy,
          })
        : productActions.requestDiscard({
            changeId: change.id,
            requestedAt,
            requestedBy,
          });
    dispatchOrFail(
      action,
      productId,
      kind === "LAUNCH" ? LAUNCH_NOT_REQUESTED : DISCARD_NOT_REQUESTED,
    ).then(
      // From here the document's pending request keeps the bar waiting.
      () => setSent(null),
      (err: unknown) => {
        setSent(null);
        setError(err instanceof Error ? err.message : LAUNCH_NOT_REQUESTED);
      },
    );
  }

  return (
    <div
      data-ready-bar
      role="status"
      className="shrink-0 border-b border-success/40 bg-success/10 px-4 py-2.5 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-semibold text-foreground">
          {READY_TO_GO_LIVE}
        </span>
        <span className="text-foreground">“{changeTitle(change)}”</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="text-muted-foreground">{CHECKS_PASSED}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {waiting === "LAUNCH" ? (
            <span className="text-xs font-medium text-foreground">
              {GOING_LIVE}
            </span>
          ) : waiting === "DISCARD" ? (
            <span className="text-xs font-medium text-muted-foreground">
              {THROWING_AWAY}
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => request("LAUNCH")}
            className="rounded-full bg-vetra-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {MAKE_IT_LIVE}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onKeepChanging}
            className={buttonClass}
          >
            {KEEP_CHANGING}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={buttonClass}
          >
            {DISCARD}
          </button>
        </div>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label={DISCARD}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
        >
          <span className="text-foreground">{DISCARD_CONFIRM}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => request("DISCARD")}
              className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
            >
              {THROW_IT_AWAY}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirming(false)}
              className={buttonClass}
            >
              {KEEP_IT}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Saving version 4 · Publishing your product · …" while it goes live. */
function LaunchLines({
  product,
  change,
}: {
  product: StudioProductState;
  change: Change;
}) {
  const version = product.versions.find(
    (v) => v.changeId === change.id && v.status === "LAUNCHING",
  );
  const host = liveHost(product.liveUrl ?? null);
  const lines = (version?.lines ?? []).filter(
    (l) => l.kind !== "MIRROR" || l.status !== "SKIPPED",
  );
  return (
    <div
      data-ready-bar="launching"
      role="status"
      className="shrink-0 border-b border-border bg-card px-4 py-2.5 text-sm"
    >
      <p className="font-semibold text-foreground">{GOING_LIVE}</p>
      {version ? (
        <ol className="mt-1 flex flex-col gap-0.5 text-xs">
          {lines.map((line) => (
            <li
              key={line.kind}
              data-launch-line={line.kind}
              className={
                line.status === "WAITING"
                  ? "text-muted-foreground"
                  : "text-foreground"
              }
            >
              <span aria-hidden className="mr-1.5">
                {LINE_ICON[line.status]}
              </span>
              {launchLineText(line.kind, version.number, host)}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
