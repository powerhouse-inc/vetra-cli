import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { resolveRegistryUrl } from '@powerhousedao/shared/registry';
import { defineCommand } from '../../framework.js';
import { getRegistryToken } from '../../auth/renown.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';

/* Read the registry packument over HTTP with the agent's Renown token and map
 * the result onto an explicit state — published / not-published / unknown — so
 * the deploy skill can decide reuse-vs-publish without guessing. The token is
 * the same registry-bound credential `reactor-project-publish` uses. */
type PublishCheck =
  | { state: 'published'; version: string }
  | { state: 'not-published' }
  | { state: 'unknown'; reason: string };

interface PublishStatus {
  check: PublishCheck;
  latest: string | null;
}

/* Keep error reasons to a couple of meaningful lines so the agent's context
 * isn't flooded. */
function condense(message: string): string {
  return message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

/* npm encodes the scope separator in scoped package names (`@scope/pkg` →
 * `@scope%2fpkg`). */
function packumentUrl(registryUrl: string, pkgName: string): string {
  const base = registryUrl.endsWith('/') ? registryUrl : `${registryUrl}/`;
  return base + pkgName.replace('/', '%2f');
}

async function checkPublish(
  registryUrl: string,
  pkgName: string,
  targetVersion: string,
  token: string | null,
): Promise<PublishStatus> {
  let res: Response;
  try {
    res = await fetch(packumentUrl(registryUrl, pkgName), {
      headers: {
        accept: 'application/vnd.npm.install-v1+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { check: { state: 'unknown', reason: condense(reason) }, latest: null };
  }

  if (res.status === 404) {
    return { check: { state: 'not-published' }, latest: null };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      check: { state: 'unknown', reason: `registry requires auth (HTTP ${res.status})` },
      latest: null,
    };
  }
  if (!res.ok) {
    return {
      check: { state: 'unknown', reason: `registry returned HTTP ${res.status}` },
      latest: null,
    };
  }

  let body: {
    versions?: Record<string, unknown>;
    'dist-tags'?: Record<string, string>;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { check: { state: 'unknown', reason: condense(reason) }, latest: null };
  }

  const latest = body['dist-tags']?.latest ?? null;
  const published = Boolean(body.versions && targetVersion in body.versions);
  return {
    check: published
      ? { state: 'published', version: targetVersion }
      : { state: 'not-published' },
    latest,
  };
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
publish or publish new changes. Reads the registry with the agent's Renown
token (the same identity \`reactor-project-publish\` uses); if the registry
requires auth and the agent isn't authorized, the result is reported as
"unknown" rather than guessed.`,
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

    const { renownUrl } = resolveCloudConfig(config);
    const token = await getRegistryToken(workdir, renownUrl, registryUrl);
    const { check, latest } = await checkPublish(
      registryUrl,
      pkgName,
      targetVersion,
      token,
    );

    const head =
      check.state === 'published'
        ? `**Published** — \`${pkgName}@${targetVersion}\` is in the registry. Reuse this publish; bump the version before publishing new changes.`
        : check.state === 'not-published'
          ? `**Not published** — \`${pkgName}@${targetVersion}\` is not in the registry. Publish it with \`reactor-project-publish\` before installing it into an environment.`
          : `**Unknown** — couldn't determine whether \`${pkgName}@${targetVersion}\` is published.\nReason: ${check.reason}\nIf the registry requires auth, authorize the agent (studio "Authorize agent" button) or run \`ph login\` first.`;

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
