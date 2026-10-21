/**
 * The story's failure line (spec §5.9, G4): the plain reason and the
 * actions that move the build forward. An action that fails says so on the
 * line ("Couldn't restart the preview."). Also the handlers that bind the
 * actions to the documents, and the sign-in dialog shown when the session
 * ends mid-build (the page underneath stays as it is).
 */
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import {
  actions as productActions,
  type StepKind,
  type StudioProductState,
} from "document-models/studio-product";
import { useMemo, useState, type ReactNode } from "react";
import { RequestBudgetControl } from "../budget/BudgetMeter.js";
import { askAgentMessage } from "../live/liveCopy.js";
import { sendSteer } from "../story/SteerBox.js";
import {
  CONTINUE_MESSAGE,
  GO_LIVE_ANYWAY_MESSAGE,
  type Failure,
  type FailureAction,
  type FailureHandlers,
} from "./failureStates.js";

const ACTION_FAILED = "Couldn't do that. Try again.";

/** No permission hook bound (the build surface's own row). */
const NO_ALLOW = () => Promise.resolve(false);

/** Dispatches `action(s)` and rejects with `message` when it doesn't apply. */
export function dispatchOrFail(
  action: Parameters<typeof dispatchActions>[0],
  documentId: string | null,
  message: string,
): Promise<void> {
  if (!documentId) return Promise.reject(new Error(message));
  return new Promise<void>((resolve, reject) => {
    let failed = false;
    dispatchActions(action, documentId, () => {
      failed = true;
    })
      .then(() => (failed ? reject(new Error(message)) : resolve()))
      .catch(() => reject(new Error(message)));
  });
}

function sendOrFail(sessionId: string | null, text: string, message: string) {
  if (!sessionId) return Promise.reject(new Error(message));
  return sendSteer(sessionId, text).then(
    () => undefined,
    () => {
      throw new Error(message);
    },
  );
}

/** The failure actions bound to the build's conversation and product. */
export function useFailureHandlers({
  sessionId,
  productId,
  product = null,
  requestedBy = "you",
  allowPublish = NO_ALLOW,
  focusSteer,
  requestBudget,
  restartPreview,
}: {
  sessionId: string | null;
  productId: string | null;
  /** The product document, for the live rows (failed change, its session). */
  product?: StudioProductState | null;
  /** Who asks the agent (the signed-in person), recorded on the request. */
  requestedBy?: string;
  /** `usePublishPermission().allow` (Task 2.8). */
  allowPublish?: () => void | Promise<boolean>;
  focusSteer: () => void;
  requestBudget: () => void;
  /** The preview pane's `restartPreview()`. */
  restartPreview: () => Promise<void>;
}): FailureHandlers {
  return useMemo(
    () => ({
      retryTurn: (userMessageId: string) =>
        dispatchOrFail(
          chatActions.retryTurn({
            userMessageId,
            requestedAt: new Date().toISOString(),
          }),
          sessionId,
          "Couldn't retry. Try again.",
        ),
      send: (text: string) =>
        sendOrFail(sessionId, text, "Couldn't send it. Try again."),
      focusSteer,
      continueBuild: async (changeId: string, kind: StepKind) => {
        const message = "Couldn't continue. Try again.";
        await dispatchOrFail(
          productActions.setStepAttention({
            changeId,
            kind,
            status: "WORKING",
            reason: null,
            at: new Date().toISOString(),
          }),
          productId,
          message,
        );
        await sendOrFail(sessionId, CONTINUE_MESSAGE, message);
      },
      waiveLint: async (changeId: string, at: string) => {
        const message = "Couldn't go live anyway. Try again.";
        await dispatchOrFail(
          [
            productActions.waiveLint({ changeId, at }),
            productActions.completeStep({ changeId, kind: "TESTS", at }),
          ],
          productId,
          message,
        );
        await sendOrFail(sessionId, GO_LIVE_ANYWAY_MESSAGE, message);
      },
      requestBudget,
      restartPreview,
      allowPublish,
      requestLaunch: (changeId: string) =>
        dispatchOrFail(
          productActions.requestLaunch({
            changeId,
            requestedAt: new Date().toISOString(),
            requestedBy,
          }),
          productId,
          "Couldn't try again. Try again.",
        ),
      requestRestart: () =>
        dispatchOrFail(
          productActions.requestRestart({
            requestedAt: new Date().toISOString(),
            requestedBy,
          }),
          productId,
          "Couldn't restart it. Try again.",
        ),
      requestRollback: (versionNumber: number) =>
        dispatchOrFail(
          productActions.requestRollback({
            requestedAt: new Date().toISOString(),
            requestedBy,
            versionNumber,
          }),
          productId,
          "Couldn't go back. Try again.",
        ),
      askAgentToFix: (changeId: string, reason: string) => {
        // F15: the failure goes into the failed change's own conversation,
        // never a new change.
        const change = product?.changes.find((c) => c.id === changeId);
        return sendOrFail(
          change?.chatSessionId ?? null,
          askAgentMessage(reason),
          "Couldn't send it. Try again.",
        );
      },
    }),
    [
      sessionId,
      productId,
      product,
      requestedBy,
      allowPublish,
      focusSteer,
      requestBudget,
      restartPreview,
    ],
  );
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : ACTION_FAILED;
}

/** A failure action's button; a rejected action shows its plain message. */
export function FailureActions({ actions }: { actions: FailureAction[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: FailureAction) {
    setError(null);
    let result: void | Promise<void>;
    try {
      result = action.run();
    } catch (err) {
      setError(errorText(err));
      return;
    }
    if (!result) return;
    setBusy(action.label);
    result
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(null));
  }

  if (actions.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <ActionButton
          key={action.label}
          disabled={busy !== null}
          onClick={() => run(action)}
        >
          {action.label}
        </ActionButton>
      ))}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** One failure: its line in the story, with its actions. */
export function FailureLine({ failure }: { failure: Failure }) {
  if (failure.small) {
    return (
      <p
        data-failure={failure.situation}
        className="text-xs text-muted-foreground"
      >
        {failure.text}
      </p>
    );
  }
  const stopped = failure.stripIcon === "✕";
  return (
    <div
      data-failure={failure.situation}
      role="status"
      className={
        "rounded-lg border px-3 py-2 text-sm " +
        (stopped
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-500/50 bg-amber-500/5")
      }
    >
      <p className="flex items-baseline gap-2 text-foreground">
        {failure.stripIcon ? (
          <span
            aria-hidden
            className={
              stopped
                ? "text-destructive"
                : "text-amber-700 dark:text-amber-400"
            }
          >
            {failure.stripIcon}
          </span>
        ) : null}
        <span>{failure.text}</span>
      </p>
      {failure.detail && failure.detail.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          {failure.detail.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {failure.situation === "budget-used-up" ? (
        <div className="mt-2">
          <RequestBudgetControl
            request={failure.budgetRequest ?? { kind: "idle" }}
            onRequest={() => void failure.actions[0]?.run()}
          />
        </div>
      ) : failure.actions.length > 0 ? (
        <div className="mt-2">
          <FailureActions actions={failure.actions} />
        </div>
      ) : null}
    </div>
  );
}

export const SIGNED_OUT_TITLE = "You're signed out";
export const SIGNED_OUT_TEXT =
  "Sign in to keep going. Everything on this page stays as it is.";

/** The sign-in dialog over the page when the session ends (spec §5.9). */
export function SignInModal({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-signed-out-title"
        className="w-[min(24rem,calc(100%-2rem))] rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <h2
          id="studio-signed-out-title"
          className="text-base font-semibold text-foreground"
        >
          {SIGNED_OUT_TITLE}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{SIGNED_OUT_TEXT}</p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-4 rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:opacity-90"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
