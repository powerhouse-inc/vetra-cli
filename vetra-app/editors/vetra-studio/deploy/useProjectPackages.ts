import { useEffect, useState } from "react";
import { fetchProjectPackage } from "../hooks/preview-server-client.js";
import { errorMessage } from "./utils.js";

export type ProjectPackageInfo = { name: string; version: string };

export type ProjectPackagesState =
  | { status: "loading" }
  | { status: "ready"; byProject: Map<string, ProjectPackageInfo | null> }
  | { status: "error"; message: string };

/**
 * Resolve every project's package.json name + version in one pass (keyed by
 * project name → its dir under the workdir). Batched so the Deploy list can
 * show fully-resolved cards instead of each card flickering as its own fetch
 * lands. A project that has no readable package maps to null.
 */
export function useProjectPackages(
  projectNames: string[],
  reloadNonce = 0,
): ProjectPackagesState {
  const [state, setState] = useState<ProjectPackagesState>({
    status: "loading",
  });
  // Newline-join: project (folder) names can't contain newlines, but could
  // contain commas.
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
          names.map(
            async (name): Promise<[string, ProjectPackageInfo | null]> => {
              try {
                const r = await fetchProjectPackage({ project: name });
                return [
                  name,
                  r.kind === "ok" ? { name: r.name, version: r.version } : null,
                ];
              } catch {
                return [name, null];
              }
            },
          ),
        );
        if (!alive.current) return;
        setState({ status: "ready", byProject: new Map(entries) });
      } catch (err) {
        if (!alive.current) return;
        setState({ status: "error", message: errorMessage(err) });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [key, reloadNonce]);

  return state;
}
