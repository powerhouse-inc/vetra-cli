/**
 * Which signature mode a Studio runs in (Task 5.SIG, ruling X39).
 *
 * A **cloud Studio** (an environment id is set) that has never run before is a
 * v2-required Studio: it creates its drive and every Studio document under
 * `v2-required`, and every write carries a v2 signature. Local Studios, and
 * cloud Studios that already existed before this mode (legacy documents),
 * keep the `legacy` policy and today's unsigned agent writes.
 *
 * The mode is **sticky**: the first boot of a new cloud Studio writes a marker
 * into `.ph/vetra/studio-signing.json` *before* anything is created, so a
 * restart — or a boot that lost the environment id — can never fall back to
 * legacy for a Studio whose documents are v2-required. The marker is also the
 * cloud signal for those boots (`isCloudStudio`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export type StudioSignatureMode = "legacy" | "v2-required";

/** CLI store folder (`<workdir>/.ph/vetra`), same root ph-clint uses. */
export function studioStoreDir(workdir: string): string {
  return path.join(path.resolve(workdir), ".ph", "vetra");
}

/** The embedded reactor's PGlite directory; present once a Studio has run. */
export function reactorStorePath(workdir: string): string {
  return path.join(studioStoreDir(workdir), "reactor-storage");
}

/** Marker file recording that this Studio is `v2-required` for good. */
export function signingMarkerPath(workdir: string): string {
  return path.join(studioStoreDir(workdir), "studio-signing.json");
}

export interface StudioSigningMarker {
  version: 1;
  mode: "v2-required";
  /** The environment id that created the Studio, for operators. */
  environmentId?: string;
  since: string;
}

/** The sticky marker, or undefined for a Studio that has never written one.
 * An unreadable marker still counts as present (and v2), so a corrupt file can
 * never downgrade a signed Studio to legacy. */
export function readSigningMarker(workdir: string): StudioSigningMarker | undefined {
  const file = signingMarkerPath(workdir);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StudioSigningMarker>;
    if (parsed?.mode === "v2-required") {
      return {
        version: 1,
        mode: "v2-required",
        environmentId:
          typeof parsed.environmentId === "string" ? parsed.environmentId : undefined,
        since: typeof parsed.since === "string" ? parsed.since : "",
      };
    }
    return undefined;
  } catch {
    return { version: 1, mode: "v2-required", since: "" };
  }
}

/** Write the sticky marker atomically (temp sibling + rename). */
export function writeSigningMarker(
  workdir: string,
  environmentId?: string,
  now: Date = new Date(),
): StudioSigningMarker {
  const marker: StudioSigningMarker = {
    version: 1,
    mode: "v2-required",
    ...(environmentId ? { environmentId } : {}),
    since: now.toISOString(),
  };
  const file = signingMarkerPath(workdir);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  renameSync(tmp, file);
  return marker;
}

/** Whether a reactor has ever run in this workdir (a pre-existing Studio). */
export function hasReactorStore(workdir: string): boolean {
  return existsSync(reactorStorePath(workdir));
}

/** The environment id config or env names, trimmed. */
export function environmentIdOf(
  config: { environmentId?: unknown } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromConfig =
    typeof config?.environmentId === "string" ? config.environmentId.trim() : "";
  return fromConfig || env.VETRA_ENVIRONMENT_ID?.trim() || undefined;
}

/**
 * Whether this is a cloud Studio: an environment id is set, or the Studio
 * already recorded that it is a v2-required cloud Studio (the sticky marker).
 * The owner gate and the signature mode use this one test, so they can never
 * disagree.
 */
export function isCloudStudio(
  config: { environmentId?: unknown } | undefined,
  workdir?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environmentIdOf(config, env)) return true;
  return workdir ? Boolean(readSigningMarker(workdir)) : false;
}

export interface StudioSigningPlan {
  cloud: boolean;
  mode: StudioSignatureMode;
  /** A new cloud Studio: the marker is not written yet. */
  fresh: boolean;
  environmentId?: string;
}

/**
 * Decide the signature mode for this boot, without writing anything.
 *
 * - marker present → `v2-required` (sticky, even without an environment id);
 * - cloud and no reactor has ever run → `v2-required` (a new Studio);
 * - otherwise → `legacy` (local Studios and cloud Studios from before the
 *   marker keep working exactly as today).
 */
export function planStudioSigning(
  workdir: string,
  config: { environmentId?: unknown } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): StudioSigningPlan {
  const environmentId = environmentIdOf(config, env);
  const marker = readSigningMarker(workdir);
  if (marker) {
    return {
      cloud: true,
      mode: "v2-required",
      fresh: false,
      environmentId: environmentId ?? marker.environmentId,
    };
  }
  const cloud = Boolean(environmentId);
  const fresh = cloud && !hasReactorStore(workdir);
  return {
    cloud,
    mode: fresh ? "v2-required" : "legacy",
    fresh,
    environmentId,
  };
}

/**
 * Make the planned mode sticky. Called before the reactor is built: a failure
 * here stops the boot of a new cloud Studio rather than letting it create a
 * legacy drive that could never become signed.
 */
export function commitStudioSigningPlan(
  workdir: string,
  plan: StudioSigningPlan,
): void {
  if (!plan.fresh) return;
  writeSigningMarker(workdir, plan.environmentId);
}
