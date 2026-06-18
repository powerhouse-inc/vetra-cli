import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { npmPublish, resolveRegistryUrl } from '@powerhousedao/shared/registry';
import { defineCommand } from '../../framework.js';
import { getRegistryToken } from '../../auth/renown.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';
import { formatProcessFailure } from '../../helpers/cli-errors.js';
import { runBuild } from './build.js';

const publishInputSchema = z.object({
  name: z.string().optional().describe('Project directory name (relative to workdir).'),
  version: z
    .string()
    .optional()
    .describe(
      "Package version to set before publishing (e.g. '1.2.3'). Updates package.json in place.",
    ),
  registry: z.url().optional().describe('Registry URL to publish to.'),
  tag: z
    .string()
    .optional()
    .describe('npm dist-tag to publish under (e.g. "dev", "next").'),
  skipBuild: z.boolean().optional().describe('Skip the build step before publishing.'),
  dryRun: z.boolean().optional().describe('Perform a dry run without actually publishing.'),
  log: z
    .boolean()
    .optional()
    .describe('Whether to log output to the console. Only enable for debugging purposes.'),
});

export const reactorProjectPublish = defineCommand({
  id: 'reactor-project-publish',
  description: `Build and publish a Reactor Package to the Powerhouse registry.

This command:
1. Optionally updates the version in package.json
2. Runs \`reactor-project-build\` — uses tsdown to produce Node.js and browser bundles so the package can be loaded in both Connect (browser) and Switchboard (Node.js) instances
3. Resolves the registry URL (--registry flag > PH_REGISTRY_URL env > powerhouse.config.json > default)
4. Mints a short-lived registry token from the agent's Renown identity
5. Runs npm publish with that token

Prerequisites: the agent must be authorized with the user's Renown identity
(the studio "Authorize agent" button, or \`ph login\` from the CLI). No npm
login is required.`,
  inputSchema: publishInputSchema,
  execute: async (
    { name, version, registry, tag, skipBuild, dryRun, log },
    { workdir, config, stdout },
  ) => {
    const projectPath = await resolveReactorProjectPath(workdir, name);
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return {
        text: `**Error:** No package.json found in \`${projectPath}\`. Ensure this is a valid npm package.`,
      };
    }

    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf-8'),
    ) as { name?: string; version?: string };

    if (version) {
      packageJson.version = version;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    }

    const registryUrl = resolveRegistryUrl({
      registry: registry || config.registryUrl,
      projectPath,
    });

    if (!skipBuild) {
      const buildResult = await runBuild(projectPath, (stdoutChunk) => {
        if (log) {
          stdout(stdoutChunk);
        }
      });
      if (!buildResult.success) {
        throw new Error(
          formatProcessFailure(
            'ph build failed; publish aborted',
            'ph build',
            projectPath,
            buildResult.output,
          ),
        );
      }
    }

    const { renownUrl } = resolveCloudConfig(config);
    const authToken = await getRegistryToken(workdir, renownUrl, registryUrl);
    if (!authToken) {
      return {
        text: `**Error:** Agent not authorized. Publishing uses the user's Renown identity — authorize the agent first (the studio "Authorize agent" button, or \`ph login\` from the CLI), then retry.`,
      };
    }

    const extraArgs: string[] = [];
    if (tag) extraArgs.push('--tag', tag);
    if (dryRun) extraArgs.push('--dry-run');

    try {
      const result = await npmPublish({
        registryUrl,
        cwd: projectPath,
        args: extraArgs,
        authToken,
      });

      const lines = [
        dryRun ? '**Dry run complete**' : '**Published successfully**',
        '',
        `| Field | Value |`,
        `|-------|-------|`,
        packageJson.name ? `| Package | \`${packageJson.name}\` |` : null,
        packageJson.version ? `| Version | \`${packageJson.version}\` |` : null,
        `| Registry | \`${registryUrl}\` |`,
        tag ? `| Tag | \`${tag}\` |` : null,
        dryRun ? `| Mode | dry-run |` : null,
      ].filter((l) => l !== null);

      const output = result.stdout.trim();
      if (output && log) {
        stdout(output);
      }

      return { text: lines.join('\n') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        text: [
          '**Publish failed**',
          '',
          `Registry: \`${registryUrl}\``,
          '',
          '```',
          message,
          '```',
        ].join('\n'),
      };
    }
  },
});
