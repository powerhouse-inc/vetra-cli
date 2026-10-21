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
import { getRegistryToken } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { fetchPackument } from "../cloud/registry-packument.js";
import { resolveRegistryUrl } from "../cloud/registry-url.js";
import {
  nextPublishVersion,
  publishReactorProject,
} from "../commands/reactor-project/publish-core.js";
import { listReactorProjects } from "../helpers/project.js";
import { LaunchError } from "./errors.js";

/** npm scope every Studio product is published under (X13). */
export const PRODUCT_SCOPE = "@vetra-apps";

/** 30 min, as the release workflow: big tarballs upload at < 1 MB/s into the cluster. */
export const LAUNCH_PUBLISH_FETCH_TIMEOUT_MS = 30 * 60_000;

export interface PublishContext {
  config: Pick<Config, "registryUrl" | "cloudRenownUrl">;
  log?: { info?: (msg: string) => void; warn?: (msg: string) => void };
}

/** Seams for tests; production uses the real registry and publish sequence. */
export interface PublishDeps {
  publish: typeof publishReactorProject;
  fetchPackument: typeof fetchPackument;
  registryToken: (workdir: string, renownUrl: string, registryUrl: string) => Promise<string | null>;
}

const defaultDeps: PublishDeps = {
  publish: publishReactorProject,
  fetchPackument,
  registryToken: (workdir, renownUrl, registryUrl) =>
    getRegistryToken(workdir, renownUrl, registryUrl),
};

function npmSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

/**
 * The package name for `project`: `@vetra-apps/<slug>` when the workspace has
 * one reactor project (the normal case), `@vetra-apps/<slug>-<project>` for
 * each project when it has several.
 */
export function productPackageName(slug: string, project: string, projectCount: number): string {
  const base = npmSegment(slug);
  if (!base) throw new Error(`Invalid product slug "${slug}".`);
  return projectCount > 1
    ? `${PRODUCT_SCOPE}/${base}-${npmSegment(project)}`
    : `${PRODUCT_SCOPE}/${base}`;
}

export interface PublishedPackage {
  name: string;
  version: string;
}

/**
 * Publish every reactor project of the workspace for one launch and return
 * the package versions to deploy. Projects publish one after another; the
 * first failure stops the launch (`LaunchError` `PERMISSION` when the agent
 * may not publish, else `PUBLISH_FAILED`).
 */
export async function publishAll(
  ctx: PublishContext,
  workdir: string,
  opts: { slug: string },
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
  const published: PublishedPackage[] = [];

  for (const project of projects) {
    const projectPath = path.join(workdir, project);
    const name = productPackageName(opts.slug, project, projects.length);
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
    const registryUrl = resolveRegistryUrl({ registry: ctx.config.registryUrl, projectPath });

    const token = await deps.registryToken(workdir, renownUrl, registryUrl);
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
        registry: ctx.config.registryUrl,
        packageName: name,
        version,
        bumpOnConflict: true,
        fetchTimeoutMs: LAUNCH_PUBLISH_FETCH_TIMEOUT_MS,
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
