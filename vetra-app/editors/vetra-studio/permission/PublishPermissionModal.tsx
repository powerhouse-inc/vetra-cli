/**
 * The one-time ask from D7, in the sign-in moment: "Let your Studio build and
 * publish for you". The primary action runs the same Renown confirmation as
 * the old top-bar button (`useAgentAuth`); the secondary one just closes it.
 * Declining never blocks the build: the Live step asks again with its
 * `! needs you` row when it gets there.
 *
 * The answer is remembered per Studio, member and change (P6): each Maker is
 * asked on their first change in the Studio, and never for someone else's
 * answer. A delegation the agent already holds means nothing to ask.
 */
import { useCallback, useEffect, useState } from "react";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import type { Member } from "../team/capabilities.js";
import { canLaunch } from "../team/roleGate.js";
import { usePublishPermission } from "./usePublishPermission.js";

export const PUBLISH_PERMISSION_TITLE =
  "Let your Studio build and publish for you";
export const PUBLISH_PERMISSION_TEXT =
  "Your Studio can build your product and put it live for you. Allow it once here; it will ask again only when your access runs out.";

const ASKED_PREFIX = "vetra-studio:publish-asked:";

/** Per Studio, per member, per change: one person's answer never covers another. */
function askedKey(
  studioId: string,
  member: string | null | undefined,
  changeId: string | null,
): string {
  return `${ASKED_PREFIX}${studioId}:${member?.toLowerCase() ?? "local"}:${changeId ?? "studio"}`;
}

/** Whether this person was already asked for this Studio and change. */
function askedBefore(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Blocked storage: ask again on the next visit rather than not at all.
    return false;
  }
}

function markAsked(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Blocked storage: the answer lasts for this visit only.
  }
}

export function PublishPermissionModal({
  productId,
  studioId,
  me = null,
  changeId = null,
}: {
  productId: string | null;
  /** The Studio (drive) the answer is remembered for. */
  studioId: string;
  /** The caller's member record (P6): each Maker is asked for themselves. */
  me?: Member | null;
  /** The change being started: the ask is per change. */
  changeId?: string | null;
}) {
  const signIn = useStudioSignIn();
  const { state, delegated, pending, allow } = usePublishPermission(
    productId,
    me?.address,
  );
  const key = askedKey(studioId, me?.address, changeId);
  const [asked, setAsked] = useState(() => askedBefore(key));

  // A different member or change is a different ask.
  useEffect(() => {
    setAsked(askedBefore(key));
  }, [key]);

  const close = useCallback(() => {
    markAsked(key);
    setAsked(true);
  }, [key]);

  // Approved (now or before this visit): the ask is done for this Studio.
  useEffect(() => {
    if (!delegated) return;
    markAsked(key);
    setAsked(true);
  }, [delegated, key]);

  // The product's permission decides too, and a MISSING/EXPIRED state is
  // asked about by the Live row (Task 2.9), not by a modal on every visit.
  // A local Studio needs no sign-in and has no Renown user to delegate from.
  const open =
    canLaunch(me) &&
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
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Not now
          </button>
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
        </div>
      </div>
    </div>
  );
}
