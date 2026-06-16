import { useRenown } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthToken } from "./cloudClient.js";
import {
  fetchMyEnvironments,
  type EnvironmentSummary,
} from "./cloudGraphql.js";
import { errorMessage } from "./utils.js";

export type EnvironmentsState =
  | { status: "loading" }
  | { status: "ready"; items: EnvironmentSummary[] }
  | { status: "error"; error: string };

/** Background revalidation cadence — keeps statuses (DEPLOYING → READY) fresh
 * without a manual refresh. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Keep only the caller's own environments. The backend `myEnvironments(MINE)`
 * scope also returns *unclaimed* envs (owner == null), so without this filter
 * other people's in-progress/unclaimed envs leak into the list. Mirrors
 * vetra.to's filterByScope MINE rule: owned by me, or unclaimed-but-created
 * by me (covers the gap before SET_OWNER lands).
 */
function filterOwn(
  items: EnvironmentSummary[],
  viewerAddress: string | undefined,
): EnvironmentSummary[] {
  const me = viewerAddress?.toLowerCase() ?? null;
  if (me === null) return [];
  return items.filter((e) => {
    const owner = e.owner?.toLowerCase() ?? null;
    const createdBy = e.createdBy?.toLowerCase() ?? null;
    return owner === me || (owner === null && createdBy === me);
  });
}

/**
 * Fetch the caller's own environments (scope MINE, server-enforced + filtered
 * to owned), revalidating on an interval. `enabled` gates on sign-in;
 * `refresh()` forces an immediate re-fetch. Revalidations keep showing the
 * last-known list (no loading flicker) and don't clobber it on transient error.
 */
export function useCloudEnvironments(
  enabled: boolean,
  viewerAddress: string | undefined,
): { state: EnvironmentsState; refresh: () => void } {
  const renown = useRenown();
  const [raw, setRaw] = useState<EnvironmentsState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Keep the current list visible while revalidating; only the first load
    // shows the loading placeholder.
    setRaw((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    getAuthToken(renown)
      .then((token) => fetchMyEnvironments("MINE", token))
      .then((items) => {
        if (!cancelled) setRaw({ status: "ready", items });
      })
      .catch((err: unknown) => {
        // Don't drop a good list on a transient revalidation failure.
        if (!cancelled)
          setRaw((prev) =>
            prev.status === "ready"
              ? prev
              : { status: "error", error: errorMessage(err) },
          );
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, renown]);

  // Poll for live status changes.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNonce((n) => n + 1), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const state = useMemo<EnvironmentsState>(() => {
    if (raw.status !== "ready") return raw;
    return { status: "ready", items: filterOwn(raw.items, viewerAddress) };
  }, [raw, viewerAddress]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { state, refresh };
}
