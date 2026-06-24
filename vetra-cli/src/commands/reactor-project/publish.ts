import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import { resolveCloudConfig } from '../../cloud/config.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';
import { publishReactorProject } from './publish-core.js';

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
    const { renownUrl } = resolveCloudConfig(config);

    const result = await publishReactorProject({
      projectPath,
      workdir,
      renownUrl,
      registry: registry || config.registryUrl,
      version,
      tag,
      skipBuild,
      dryRun,
      log: log ? stdout : undefined,
    });

    if (result.kind === 'no-package' || result.kind === 'auth-required') {
      return { text: `**Error:** ${result.error}` };
    }
    if (result.kind === 'failed') {
      return {
        text: ['**Publish failed**', '', '```', result.error, '```'].join('\n'),
      };
    }

    const lines = [
      dryRun ? '**Dry run complete**' : '**Published successfully**',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Package | \`${result.packageName}\` |`,
      `| Version | \`${result.version}\` |`,
      `| Registry | \`${result.registry}\` |`,
      tag ? `| Tag | \`${tag}\` |` : null,
      dryRun ? `| Mode | dry-run |` : null,
    ].filter((l) => l !== null);

    return { text: lines.join('\n') };
  },
});
