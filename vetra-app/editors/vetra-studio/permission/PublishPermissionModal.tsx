/**
 * The one-time ask from D7, in the sign-in moment: "Let your Studio build and
 * publish for you". The primary action runs the same Renown confirmation as
 * the old top-bar button (`useAgentAuth`); the secondary one just closes it.
 * Declining never blocks the build: the Live step asks again with its
 * `! needs you` row when it gets there.
 *
 * The answer is remembered per Studio (its drive), so the modal isn't shown
 * on every render; a delegation the agent already holds means nothing to ask.
 */
import { useCallback, useEffect, useState } from "react";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import { usePublishPermission } from "./usePublishPermission.js";

export const PUBLISH_PERMISSION_TITLE =
  "Let your Studio build and publish for you";
export const PUBLISH_PERMISSION_TEXT =
  "Your Studio can build your product and put it live for you. Allow it once here; it will ask again only when your access runs out.";

/** While the owner still has to approve in Renown (its tab may be closed). */
export const PUBLISH_PERMISSION_WAITING =
  "Waiting for you to approve in Renown.";

const ASKED_PREFIX = "vetra-studio:publish-asked:";

/** Whether this Studio has already asked this browser. */
function askedBefore(studioId: string): boolean {
  try {
    return window.localStorage.getItem(ASKED_PREFIX + studioId) === "1";
  } catch {
    // Blocked storage: ask again on the next visit rather than not at all.
    return false;
  }
}

function markAsked(studioId: string): void {
  try {
    window.localStorage.setItem(ASKED_PREFIX + studioId, "1");
  } catch {
    // Blocked storage: the answer lasts for this visit only.
  }
}

export function PublishPermissionModal({
  productId,
  studioId,
}: {
  productId: string | null;
  /** The Studio (drive) the answer is remembered for. */
  studioId: string;
}) {
  const signIn = useStudioSignIn();
  const { state, delegated, pending, waiting, allow, reopen, dismiss } =
    usePublishPermission(productId);
  const [asked, setAsked] = useState(() => askedBefore(studioId));

  const close = useCallback(() => {
    dismiss();
    markAsked(studioId);
    setAsked(true);
  }, [studioId, dismiss]);

  // Approved (now or before this visit): the ask is done for this Studio.
  useEffect(() => {
    if (!delegated) return;
    markAsked(studioId);
    setAsked(true);
  }, [delegated, studioId]);

  // The product's permission decides too, and a MISSING/EXPIRED state is
  // asked about by the Live row (Task 2.9), not by a modal on every visit.
  // A local Studio needs no sign-in and has no Renown user to delegate from.
  const open =
    signIn.status === "signed-in" &&
    signIn.hasUser &&
    !asked &&
    !delegated &&
    state !== "GRANTED" &&
    !(productId !== null && state === null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-permission-title"
        className="w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <h2
          id="publish-permission-title"
          className="text-base font-semibold text-foreground"
        >
          {PUBLISH_PERMISSION_TITLE}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {PUBLISH_PERMISSION_TEXT}
        </p>
        {waiting ? (
          <p className="mt-3 text-sm text-foreground">
            {PUBLISH_PERMISSION_WAITING}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Not now
          </button>
          {waiting ? (
            <button
              type="button"
              onClick={() => void reopen()}
              className="rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:opacity-90"
            >
              Open Renown again
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                void allow().then((granted) => {
                  if (granted) close();
                });
              }}
              className="rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Waiting for Renown…" : "Allow"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
