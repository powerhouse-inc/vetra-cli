/**
 * Publish step of a launch: every reactor project in the workspace is
 * published at a fresh version (Ruling E4: `nextPublishVersion`, patch past the
 * highest published) under the product's own name `@vetra-apps/<liveSlug>`
 * (controller ruling X13; the registry serves `@vetra-apps/*` from local
 * storage only, never from npmjs).
 *
 * The publish rewrites `package.json` (name, version, content hash) for the
 * build and the tarball; the original file is put back afterwards, so the
 * working tree still equals the version's snapshot.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../framework.js";
import { resolveCloudConfig } from "../cloud/config.js";
import {
  publishIdentity,
  registryTokenFor,
  type PublishIdentity,
} from "../team/publisher.js";
import { fetchPackument } from "../cloud/registry-packument.js";
import { resolveLaunchRegistryUrl } from "../cloud/registry-url.js";
import {
  nextPublishVersion,
  publishReactorProject,
} from "../commands/reactor-project/publish-core.js";
import { listReactorProjects } from "../helpers/project.js";
import { LaunchError } from "./errors.js";
import { projectDirs } from "./git-versions.js";

/** npm scope every Studio product is published under (X13). */
export const PRODUCT_SCOPE = "@vetra-apps";

/** 30 min, as the release workflow: big tarballs upload at < 1 MB/s into the cluster. */
export const LAUNCH_PUBLISH_FETCH_TIMEOUT_MS = 30 * 60_000;

export interface PublishContext {
  config: Pick<Config, "registryUrl" | "cloudRenownUrl"> &
    Partial<Pick<Config, "environmentId" | "cloudSwitchboardUrl" | "studioOrgId">>;
  log?: { info?: (msg: string) => void; warn?: (msg: string) => void };
  /** Seams for the org-publisher lookup (tests). */
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/** Seams for tests; production uses the real registry and publish sequence. */
export interface PublishDeps {
  publish: typeof publishReactorProject;
  fetchPackument: typeof fetchPackument;
  /** Who publishes: the owner (personal Studio) or the org's publisher. */
  identity: (ctx: PublishContext, workdir: string) => Promise<PublishIdentity>;
  /** The registry token for that identity. */
  registryToken: (
    ctx: PublishContext,
    workdir: string,
    identity: PublishIdentity,
    registryUrl: string,
  ) => Promise<string | null>;
}

const defaultDeps: PublishDeps = {
  publish: publishReactorProject,
  fetchPackument,
  identity: (ctx, workdir) => publishIdentity({ ...ctx, workdir }),
  registryToken: (ctx, workdir, identity, registryUrl) =>
    registryTokenFor({ ...ctx, workdir }, identity, registryUrl),
};

function npmSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

/**
 * The package name for `project` on a product's first launch:
 * `@vetra-apps/<slug>` when the workspace has one reactor project (the normal
 * case), `@vetra-apps/<slug>-<project>` for each project when it has several.
 */
export function productPackageName(slug: string, project: string, projectCount: number): string {
  const base = npmSegment(slug);
  if (!base) throw new Error(`Invalid product slug "${slug}".`);
  return projectCount > 1
    ? `${PRODUCT_SCOPE}/${base}-${npmSegment(project)}`
    : `${PRODUCT_SCOPE}/${base}`;
}

/** What is live now: its git tag and the packages recorded on its Version. */
export interface LiveRelease {
  tag: string;
  packages: { name: string; version: string }[];
}

/**
 * Stable package names (X24): a project keeps the name it was published
 * under in the live version. The recorded names are matched back to the
 * project dirs of the live tag: the bare `@vetra-apps/<slug>` belongs to the
 * only project the live tag had; `@vetra-apps/<slug>-<dir>` to that dir. A
 * project with no recorded name gets `@vetra-apps/<slug>-<dir>` (or the bare
 * name on a first launch with one project), never one already recorded.
 */
export function assignPackageNames(
  slug: string,
  projects: string[],
  live: { projects: string[]; names: string[] } | null,
): Map<string, string> {
  const bare = productPackageName(slug, "", 1);
  const recorded = new Map<string, string>();
  if (live) {
    for (const name of live.names) {
      if (name === bare) {
        if (live.projects.length === 1) recorded.set(live.projects[0], name);
        continue;
      }
      const dir = live.projects.find((d) => productPackageName(slug, d, 2) === name);
      if (dir) recorded.set(dir, name);
    }
  }
  const taken = new Set(live?.names ?? []);
  const names = new Map<string, string>();
  for (const project of projects) {
    const kept = recorded.get(project);
    if (kept) {
      names.set(project, kept);
      continue;
    }
    const fresh = live?.names.length ? 2 : projects.length;
    let name = productPackageName(slug, project, fresh);
    for (let i = 2; taken.has(name); i++) name = `${productPackageName(slug, project, 2)}-${i}`;
    taken.add(name);
    names.set(project, name);
  }
  return names;
}

export interface PublishedPackage {
  name: string;
  version: string;
}

/**
 * Publish every reactor project of the workspace for one launch and return
 * the package versions to deploy. Pass the live release (`live`) on every
 * launch after the first so each project keeps its package name. Projects publish one after another; the
 * first failure stops the launch (`LaunchError` `PERMISSION` when the agent
 * may not publish, else `PUBLISH_FAILED`).
 */
export async function publishAll(
  ctx: PublishContext,
  workdir: string,
  opts: { slug: string; live?: LiveRelease | null },
  deps: PublishDeps = defaultDeps,
): Promise<PublishedPackage[]> {
  const projects = await listReactorProjects(workdir);
  if (projects.length === 0) {
    throw new LaunchError(
      "NOTHING_TO_PUBLISH",
      "there is nothing to publish yet",
      `No reactor project found in ${workdir}.`,
    );
  }
  const { renownUrl } = resolveCloudConfig(ctx.config);
  const live = opts.live
    ? {
        projects: await projectDirs(workdir, opts.live.tag, { onDisk: false }),
        names: opts.live.packages.map((p) => p.name),
      }
    : null;
  const names = assignPackageNames(opts.slug, projects, live);
  const published: PublishedPackage[] = [];
  // Resolved once per launch: one cloud lookup at most, and every project of
  // this launch publishes under the same identity.
  const identity = await deps.identity(ctx, workdir);

  for (const project of projects) {
    const projectPath = path.join(workdir, project);
    const name = names.get(project)!;
    const packageJsonPath = path.join(projectPath, "package.json");
    const original = await readFile(packageJsonPath, "utf-8").catch(() => null);
    if (original === null) {
      throw new LaunchError(
        "PUBLISH_FAILED",
        "publishing didn't finish",
        `No package.json in ${project}.`,
      );
    }
    const localVersion = (JSON.parse(original) as { version?: string }).version ?? null;
    // R25: a Studio without a named registry publishes to its stack's one.
    const registryUrl = resolveLaunchRegistryUrl({
      registry: ctx.config.registryUrl,
      projectPath,
      environmentId: ctx.config.environmentId,
      cloudSwitchboardUrl: ctx.config.cloudSwitchboardUrl,
    });

    const token = await deps.registryToken(ctx, workdir, identity, registryUrl);
    const packument = await deps.fetchPackument(registryUrl, name, token);
    if (packument.kind === "error") {
      throw new LaunchError(
        "PUBLISH_FAILED",
        "publishing didn't finish",
        `Could not read ${name} from the registry: ${packument.reason}`,
      );
    }
    if (packument.kind === "auth-required") {
      throw new LaunchError(
        "PERMISSION",
        "your Studio needs your OK to publish",
        `Registry refused reading ${name} (HTTP ${packument.status}).`,
      );
    }
    const versions = packument.kind === "ok" ? Object.keys(packument.versions) : [];
    const version = nextPublishVersion(localVersion, versions);
    ctx.log?.info?.(`[launch] publishing ${name}@${version} (${project})`);

    let result: Awaited<ReturnType<typeof publishReactorProject>>;
    try {
      result = await deps.publish({
        projectPath,
        workdir,
        renownUrl,
        registry: registryUrl,
        packageName: name,
        version,
        bumpOnConflict: true,
        fetchTimeoutMs: LAUNCH_PUBLISH_FETCH_TIMEOUT_MS,
        registryToken: token,
      });
    } finally {
      await writeFile(packageJsonPath, original);
    }

    if (result.kind === "auth-required") {
      throw new LaunchError("PERMISSION", "your Studio needs your OK to publish", result.error);
    }
    if (result.kind !== "ok") {
      throw new LaunchError("PUBLISH_FAILED", "publishing didn't finish", result.error);
    }
    published.push({ name: result.packageName, version: result.version });
  }
  return published;
}
