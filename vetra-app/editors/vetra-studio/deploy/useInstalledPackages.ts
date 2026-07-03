import type { ISigner } from "document-model";
import { useEffect, useState } from "react";
import { loadEnvironmentController } from "./cloudController.js";
import {
  resolveServiceLinks,
  type EnvServiceLink,
} from "./projectDeployments.js";
import { errorMessage } from "./utils.js";

/** One environment's installed packages: name → pinned version (null when the
 * install pins no version), plus its enabled service URLs. Keyed alongside the
 * env id + display label. */
export type EnvInstall = {
  envId: string;
  label: string;
  packages: Map<string, string | null>;
  services: EnvServiceLink[];
};

export type InstalledPackagesState =
  | { status: "idle" } // not signed in — can't determine deploy status
  | { status: "loading" }
  | { status: "ready"; byPackage: Map<string, string[]>; byEnv: EnvInstall[] }
  | { status: "error"; message: string };

/**
 * Load each environment's document and build a map of installed package name →
 * the environments (by label) that have it. A project counts as deployed when
 * its package name is a key here, and the value lists where. The list query
 * doesn't carry packages, so each environment document is pulled once (no
 * subscription); envs that fail to load are skipped.
 *
 * Re-runs when the environments (ids + names) change, the drive, or the
 * signer — not on every poll.
 */
export function useInstalledPackages(
  envs: { id: string; name: string | null }[],
  driveId: string,
  signer: ISigner | null,
  reloadNonce = 0,
): InstalledPackagesState {
  const [state, setState] = useState<InstalledPackagesState>({
    status: "idle",
  });
  const envsKey = JSON.stringify(envs.map((e) => [e.id, e.name]));

  useEffect(() => {
    if (!signer) {
      setState({ status: "idle" });
      return;
    }
    const list = JSON.parse(envsKey) as [string, string | null][];
    if (list.length === 0) {
      setState({ status: "ready", byPackage: new Map(), byEnv: [] });
      return;
    }
    const alive = { current: true };
    setState({ status: "loading" });
    void (async () => {
      try {
        const perEnv = await Promise.all(
          list.map(async ([id, name]): Promise<EnvInstall> => {
            const label = name?.trim() || id;
            const packages = new Map<string, string | null>();
            let services: EnvServiceLink[] = [];
            try {
              const ctrl = await loadEnvironmentController({
                documentId: id,
                parentIdentifier: driveId,
                signer,
              });
              for (const p of ctrl.state.global.packages) {
                const pkg = p.name.trim();
                if (pkg) packages.set(pkg, p.version ?? null);
              }
              services = resolveServiceLinks(ctrl.state.global);
            } catch {
              // env failed to load — counts as no installs
            }
            return { envId: id, label, packages, services };
          }),
        );
        if (!alive.current) return;
        const byPackage = new Map<string, string[]>();
        for (const { label, packages } of perEnv) {
          for (const pkg of packages.keys()) {
            const where = byPackage.get(pkg);
            if (where) {
              if (!where.includes(label)) where.push(label);
            } else {
              byPackage.set(pkg, [label]);
            }
          }
        }
        setState({ status: "ready", byPackage, byEnv: perEnv });
      } catch (err) {
        if (!alive.current) return;
        setState({ status: "error", message: errorMessage(err) });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [envsKey, driveId, signer, reloadNonce]);

  return state;
}
