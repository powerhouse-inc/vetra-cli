/**
 * The canonical publish sequence, shared by the `reactor-project-publish`
 * command (the agent's path) and the Deploy flow's publish endpoint so both do
 * exactly the same thing: embed the source content hash, build, mint a registry
 * token from the agent's Renown identity, and `npm publish` to the resolved
 * Powerhouse registry (never the public npm).
 *
 * `bumpOnConflict` makes a version already present on the registry bump-and-
 * retry instead of failing — the registry's rejected PUT is authoritative, so
 * the Deploy flow can resolve version collisions without the user seeing them.
 */
import fs from "node:fs";
import path from "node:path";
import { npmPublish, resolveRegistryUrl } from "@powerhousedao/shared/registry";
import { getRegistryToken } from "../../auth/renown.js";
import {
  computeProjectContentHash,
  CONTENT_HASH_FIELD,
} from "../../helpers/project-fingerprint.js";
import { runBuild } from "./build.js";

type SemverCore = [number, number, number];

function parseSemver(v: string): SemverCore {
  const core = v.split("-")[0].split("+")[0];
  const [a, b, c] = core.split(".");
  return [Number(a) || 0, Number(b) || 0, Number(c) || 0];
}

function cmpSemver(a: SemverCore, b: SemverCore): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function fmtSemver(v: SemverCore): string {
  return `${v[0]}.${v[1]}.${v[2]}`;
}

function bumpPatch(version: string): string {
  const [a, b, c] = parseSemver(version);
  return `${a}.${b}.${c + 1}`;
}

/** A version not already on the registry: the local version when it's ahead of
 * everything published, else the highest known version bumped until free. The
 * registry's rejected PUT remains the final arbiter (see the conflict retry). */
export function nextPublishVersion(
  localVersion: string | null,
  published: string[],
): string {
  const taken = new Set(published);
  const local = localVersion ? parseSemver(localVersion) : null;
  const maxPublished =
    published.map(parseSemver).sort(cmpSemver).at(-1) ?? null;

  if (
    localVersion &&
    local &&
    !taken.has(localVersion) &&
    (!maxPublished || cmpSemver(local, maxPublished) > 0)
  ) {
    return localVersion;
  }

  const base = maxPublished
    ? local && cmpSemver(local, maxPublished) > 0
      ? local
      : maxPublished
    : (local ?? [0, 0, 0]);
  let next: SemverCore = [base[0], base[1], base[2]];
  do {
    next = [next[0], next[1], next[2] + 1];
  } while (taken.has(fmtSemver(next)));
  return fmtSemver(next);
}

/** npm's "this version already exists" family of errors. */
function isVersionConflict(msg: string): boolean {
  return /\b409\b|already present|cannot publish over|EPUBLISHCONFLICT|previously published/i.test(
    msg,
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** npm dumps the whole tarball listing on failure. Keep only the error lines
 * so a caller (and the UI) shows something readable. */
function condensePublishError(msg: string): string {
  const lines = msg
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^npm notice/i.test(l))
    .filter((l) => !/complete log of this run|debug-\d/i.test(l));
  const errLines = lines.filter((l) =>
    /npm error|error[: ]|E\d{3}|conflict|forbidden|unauthorized/i.test(l),
  );
  const picked = (errLines.length ? errLines : lines)
    .slice(-4)
    .map((l) => l.replace(/^npm error\s*/i, "").trim());
  return picked.join("\n") || "Publish failed.";
}

function tailLines(output: string, n: number): string {
  return output
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-n)
    .join("\n");
}

export type PublishCoreResult =
  | { kind: "ok"; packageName: string; version: string; registry: string }
  | { kind: "no-package"; error: string }
  | { kind: "auth-required"; error: string }
  | { kind: "failed"; error: string };

const MAX_PUBLISH_ATTEMPTS = 8;

export async function publishReactorProject(opts: {
  projectPath: string;
  workdir: string;
  renownUrl: string;
  /** Registry override; the resolver applies env > project config > built-in. */
  registry?: string;
  /** Version to write before publishing; falls back to package.json's. */
  version?: string;
  /** Precomputed content hash (skips recompute when the caller already has it). */
  contentHash?: string;
  tag?: string;
  skipBuild?: boolean;
  dryRun?: boolean;
  /** Bump the patch and retry when the registry rejects an existing version. */
  bumpOnConflict?: boolean;
  log?: (chunk: string) => void;
}): Promise<PublishCoreResult> {
  const packageJsonPath = path.join(opts.projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {
      kind: "no-package",
      error: `No package.json found in ${opts.projectPath}.`,
    };
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
    name?: string;
    version?: string;
    powerhouse?: Record<string, unknown>;
  };
  if (!packageJson.name) {
    return { kind: "no-package", error: 'package.json has no "name" field.' };
  }
  if (opts.version) packageJson.version = opts.version;

  const contentHash =
    opts.contentHash ?? (await computeProjectContentHash(opts.projectPath));
  packageJson.powerhouse = {
    ...(packageJson.powerhouse ?? {}),
    [CONTENT_HASH_FIELD]: contentHash,
  };

  const registryUrl = resolveRegistryUrl({
    registry: opts.registry,
    projectPath: opts.projectPath,
  });

  const writePackageJson = () =>
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + "\n",
    );
  if (!opts.dryRun) writePackageJson();

  if (!opts.skipBuild) {
    const build = await runBuild(opts.projectPath, opts.log);
    if (!build.success) {
      return { kind: "failed", error: `Build failed:\n${tailLines(build.output, 20)}` };
    }
  }

  const token = await getRegistryToken(opts.workdir, opts.renownUrl, registryUrl);
  if (!token) {
    return {
      kind: "auth-required",
      error:
        'Agent not authorized to publish. Authorize the agent (the studio "Authorize agent" button, or `ph login`), then retry.',
    };
  }

  const extraArgs: string[] = [];
  if (opts.tag) extraArgs.push("--tag", opts.tag);
  if (opts.dryRun) extraArgs.push("--dry-run");

  let version = packageJson.version ?? "0.0.1";
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    try {
      await npmPublish({
        registryUrl,
        cwd: opts.projectPath,
        args: extraArgs,
        authToken: token,
      });
      return {
        kind: "ok",
        packageName: packageJson.name,
        version,
        registry: registryUrl,
      };
    } catch (err) {
      const msg = message(err);
      if (
        opts.bumpOnConflict &&
        !opts.dryRun &&
        isVersionConflict(msg) &&
        attempt < MAX_PUBLISH_ATTEMPTS - 1
      ) {
        version = bumpPatch(version);
        packageJson.version = version;
        writePackageJson();
        continue;
      }
      return { kind: "failed", error: condensePublishError(msg) };
    }
  }
  return {
    kind: "failed",
    error: `Could not find a free version to publish after ${MAX_PUBLISH_ATTEMPTS} attempts.`,
  };
}
