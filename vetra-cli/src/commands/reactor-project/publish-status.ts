import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { resolveRegistryUrl } from '@powerhousedao/shared/registry';
import { defineCommand } from '../../framework.js';
import { getRegistryToken } from '../../auth/renown.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { fetchPackument } from '../../cloud/registry-packument.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';

/* Read the registry packument with the agent's Renown token and map the result
 * onto an explicit state — published / not-published / unknown — so the deploy
 * skill can decide reuse-vs-publish without guessing. The token is the same
 * registry-bound credential `reactor-project-publish` uses. */
type PublishCheck =
  | { state: 'published'; version: string }
  | { state: 'not-published' }
  | { state: 'unknown'; reason: string };

interface PublishStatus {
  check: PublishCheck;
  latest: string | null;
}

async function checkPublish(
  registryUrl: string,
  pkgName: string,
  targetVersion: string,
  token: string | null,
): Promise<PublishStatus> {
  const packument = await fetchPackument(registryUrl, pkgName, token);
  if (packument.kind === 'not-found') {
    return { check: { state: 'not-published' }, latest: null };
  }
  if (packument.kind === 'auth-required') {
    return {
      check: {
        state: 'unknown',
        reason: `registry requires auth (HTTP ${packument.status})`,
      },
      latest: null,
    };
  }
  if (packument.kind === 'error') {
    return { check: { state: 'unknown', reason: packument.reason }, latest: null };
  }
  const published = targetVersion in packument.versions;
  return {
    check: published
      ? { state: 'published', version: targetVersion }
      : { state: 'not-published' },
    latest: packument.latest,
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
