import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { fetchPackageVersionFromNpmRegistry } from '@powerhousedao/shared/clis';
import { resolveRegistryUrl } from '@powerhousedao/shared/registry';
import { defineCommand } from '../../framework.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';

/* `npm view <spec> version` (via fetchPackageVersionFromNpmRegistry) prints the
 * version when the spec resolves, exits 0 with empty output when the package
 * exists but the version doesn't, and exits non-zero with E404 when the package
 * is absent. Map all three — plus auth/network failures — onto an explicit
 * state so the deploy skill can decide reuse-vs-publish without guessing. */
type PublishCheck =
  | { state: 'published'; version: string }
  | { state: 'not-published' }
  | { state: 'unknown'; reason: string };

const NOT_FOUND = /404|E404|not found|not in this registry|no such package/i;

/* npm dumps a multi-line stderr (errno block, proxy-help boilerplate); keep the
 * first couple of meaningful lines so the reason stays useful without flooding
 * the agent's context. */
function condense(message: string): string {
  return message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

async function checkVersion(
  pkgName: string,
  version: string,
  registryUrl: string,
): Promise<PublishCheck> {
  try {
    const out = (
      await fetchPackageVersionFromNpmRegistry(`${pkgName}@${version}`, registryUrl)
    ).trim();
    return out ? { state: 'published', version: out } : { state: 'not-published' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NOT_FOUND.test(reason)
      ? { state: 'not-published' }
      : { state: 'unknown', reason: condense(reason) };
  }
}

async function fetchLatest(
  pkgName: string,
  registryUrl: string,
): Promise<string | null> {
  try {
    return (await fetchPackageVersionFromNpmRegistry(pkgName, registryUrl)).trim() || null;
  } catch {
    return null;
  }
}

const inputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      'Project directory name (relative to workdir). Only needed when the workdir is not already a Reactor package project.',
    ),
  version: z
    .string()
    .optional()
    .describe(
      "Version to check. Defaults to the project's package.json version. Pass a specific version to check whether that exact release is published.",
    ),
  registry: z
    .url()
    .optional()
    .describe(
      'Registry URL to query (flag > PH_REGISTRY_URL env > config.registryUrl > default). Pass the environment\'s package registry so the check matches where the env installs from.',
    ),
});

export const reactorProjectPublishStatus = defineCommand({
  id: 'reactor-project-publish-status',
  description: `Check whether a Reactor package's name@version is already published to the registry.

Reports published / not-published / unknown for the version, plus the latest
published version, so the deploy flow can decide whether to reuse the last
publish or publish new changes. Uses the same registry resolution and npm
auth (~/.npmrc) as \`reactor-project-publish\`; if the registry requires auth and
you're not logged in, the result is reported as "unknown" rather than guessed.`,
  inputSchema,
  execute: async ({ name, version, registry }, { workdir, config }) => {
    const projectPath = await resolveReactorProjectPath(workdir, name);
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return {
        text: `**Error:** No package.json found in \`${projectPath}\`. Ensure this is a valid npm package.`,
      };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      name?: string;
      version?: string;
    };
    const pkgName = packageJson.name;
    if (!pkgName) {
      return {
        text: `**Error:** package.json in \`${projectPath}\` has no "name" field.`,
      };
    }
    const targetVersion = version ?? packageJson.version;
    if (!targetVersion) {
      return {
        text: `**Error:** No version to check — pass \`--version\` or set "version" in \`${packageJsonPath}\`.`,
      };
    }

    const registryUrl = resolveRegistryUrl({
      registry: registry || config.registryUrl,
      projectPath,
    });

    const check = await checkVersion(pkgName, targetVersion, registryUrl);
    const latest = await fetchLatest(pkgName, registryUrl);

    const head =
      check.state === 'published'
        ? `**Published** — \`${pkgName}@${targetVersion}\` is in the registry. Reuse this publish; bump the version before publishing new changes.`
        : check.state === 'not-published'
          ? `**Not published** — \`${pkgName}@${targetVersion}\` is not in the registry. Publish it with \`reactor-project-publish\` before installing it into an environment.`
          : `**Unknown** — couldn't determine whether \`${pkgName}@${targetVersion}\` is published.\nReason: ${check.reason}\nIf the registry requires auth, log in first: \`npm login --registry ${registryUrl}\`.`;

    const lines = [
      head,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Package | \`${pkgName}\` |`,
      `| Version checked | \`${targetVersion}\` |`,
      `| Latest published | ${latest ? `\`${latest}\`` : '—'} |`,
      `| Registry | \`${registryUrl}\` |`,
    ];
    return { text: lines.join('\n') };
  },
});
