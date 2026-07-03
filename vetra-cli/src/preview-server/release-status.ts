/**
 * Decide whether a reactor-project needs a new release: compare the project's
 * current source content hash against the hash embedded in the latest published
 * version on the registry. Powers the Deploy section's "up to date" / "needs
 * release" indicator.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRegistryUrl } from "@powerhousedao/shared/registry";
import { getRegistryToken } from "../auth/renown.js";
import { fetchPackument } from "../cloud/registry-packument.js";
import {
  computeProjectContentHash,
  CONTENT_HASH_FIELD,
} from "../helpers/project-fingerprint.js";
import { resolveReactorProjectPath } from "../helpers/project.js";

export type ReleaseStatusResult =
  | {
      kind: "ok";
      project: string;
      packageName: string;
      localVersion: string | null;
      publishedVersion: string | null;
      upToDate: boolean;
      needsRelease: boolean;
      reason: "never-published" | "no-baseline" | "content-changed" | "up-to-date";
    }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "no-package"; project: string; error: string }
  | { kind: "unknown"; project: string; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function checkReleaseStatus(opts: {
  workdir: string;
  project: string;
  /** Registry override (query param > configured default); the resolver applies
   * the rest of the precedence (env > project config > built-in default). */
  registryUrl?: string;
  renownUrl: string;
}): Promise<ReleaseStatusResult> {
  const { workdir, project, registryUrl: registryOverride, renownUrl } = opts;
  if (!project) {
    return { kind: "unknown-project", project, error: "No project specified." };
  }

  let projectPath: string;
  try {
    projectPath = await resolveReactorProjectPath(workdir, project);
  } catch (err) {
    return { kind: "unknown-project", project, error: message(err) };
  }

  let pkg: { name?: string; version?: string };
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf-8");
    pkg = JSON.parse(raw) as typeof pkg;
  } catch (err) {
    return { kind: "no-package", project, error: message(err) };
  }
  if (!pkg.name) {
    return { kind: "no-package", project, error: 'package.json has no "name" field.' };
  }
  const packageName = pkg.name;
  const localVersion = pkg.version ?? null;

  const currentHash = await computeProjectContentHash(projectPath);
  const registryUrl = resolveRegistryUrl({
    registry: registryOverride,
    projectPath,
  });
  const token = await getRegistryToken(workdir, renownUrl, registryUrl);
  const packument = await fetchPackument(registryUrl, packageName, token);

  const ok = (
    publishedVersion: string | null,
    upToDate: boolean,
    reason: "never-published" | "no-baseline" | "content-changed" | "up-to-date",
  ): ReleaseStatusResult => ({
    kind: "ok",
    project,
    packageName,
    localVersion,
    publishedVersion,
    upToDate,
    needsRelease: !upToDate,
    reason,
  });

  if (packument.kind === "not-found") {
    return ok(null, false, "never-published");
  }
  if (packument.kind === "auth-required") {
    return {
      kind: "unknown",
      project,
      error: `registry requires auth (HTTP ${packument.status})`,
    };
  }
  if (packument.kind === "error") {
    return { kind: "unknown", project, error: packument.reason };
  }

  const latest = packument.latest;
  const latestVersion = latest ? packument.versions[latest] : undefined;
  if (!latest || !latestVersion) {
    return ok(null, false, "never-published");
  }

  const ph = latestVersion.powerhouse;
  const rawHash = ph?.[CONTENT_HASH_FIELD];
  const publishedHash = typeof rawHash === "string" ? rawHash : null;
  if (!publishedHash) {
    return ok(latest, false, "no-baseline");
  }

  const upToDate = publishedHash === currentHash;
  return ok(latest, upToDate, upToDate ? "up-to-date" : "content-changed");
}
