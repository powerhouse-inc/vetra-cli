import { useEffect, useState } from "react";
import { fetchReleaseStatus } from "../hooks/preview-server-client.js";

/** Per-project release status. `known: false` when it can't be determined
 * (registry unreachable, auth required, no package) — the UI shows nothing. */
export type ReleaseStatus =
  | {
      known: true;
      upToDate: boolean;
      needsRelease: boolean;
      localVersion: string | null;
      publishedVersion: string | null;
    }
  | { known: false };

export type ReleaseStatusesState =
  | { status: "loading" }
  | { status: "ready"; byProject: Map<string, ReleaseStatus> }
  | { status: "error"; message: string };

const UNKNOWN: ReleaseStatus = { known: false };

/**
 * Resolve every project's release status in one pass (batched, keyed by project
 * name). Mirrors useProjectPackages so the Deploy list can show fully-resolved
 * cards instead of each card flickering as its own fetch lands.
 */
export function useReleaseStatuses(
  projectNames: string[],
  reloadNonce = 0,
): ReleaseStatusesState {
  const [state, setState] = useState<ReleaseStatusesState>({
    status: "loading",
  });
  const key = projectNames.join("\n");

  useEffect(() => {
    const names = key ? key.split("\n") : [];
    if (names.length === 0) {
      setState({ status: "ready", byProject: new Map() });
      return;
    }
    const alive = { current: true };
    setState({ status: "loading" });
    void (async () => {
      try {
        const entries = await Promise.all(
          names.map(async (name): Promise<[string, ReleaseStatus]> => {
            try {
              const r = await fetchReleaseStatus({ project: name });
              return [
                name,
                r.kind === "ok"
                  ? {
                      known: true,
                      upToDate: r.upToDate,
                      needsRelease: r.needsRelease,
                      localVersion: r.localVersion,
                      publishedVersion: r.publishedVersion,
                    }
                  : UNKNOWN,
              ];
            } catch {
              return [name, UNKNOWN];
            }
          }),
        );
        if (!alive.current) return;
        setState({ status: "ready", byProject: new Map(entries) });
      } catch (err) {
        if (!alive.current) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [key, reloadNonce]);

  return state;
}
