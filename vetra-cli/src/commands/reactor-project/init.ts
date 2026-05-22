import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import { requireOption } from '../../helpers/cli-errors.js';

function getPhVersion(): string {
  try {
    const output = execFileSync('ph', ['--version'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const match = output.match(/PH CMD version:\s*(\S+)/);
    if (match?.[1]) return match[1];
    throw new Error('Could not parse version from ph --version output');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        'ph CLI is not installed. Install it with: pnpm install -g ph-cmd@latest',
      );
    }
    throw err;
  }
}

const NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

const inputSchema = z.object({
  name: z
    .string()
    .default('')
    .describe('Project name (alphanumeric, hyphens, underscores)'),
  version: z
    .string()
    .refine(
      (v) =>
        ['dev', 'staging', 'latest'].includes(v) ||
        /^\d+\.\d+\.\d+/.test(v),
      'Must be dev, staging, latest, or an exact semver version (e.g. 6.0.0-dev.163)',
    )
    .optional()
    .describe(
      'Powerhouse version: release tag (dev|staging|latest) or exact semver (e.g. 6.0.0-dev.163)',
    ),
});

export const reactorProjectInit = defineCommand({
  id: 'reactor-project-init',
  description: 'Initialize a new Reactor package project',
  inputSchema,
  execute: async ({ name, version }, { workdir, config, runProcess }) => {
    requireOption(name, 'name');
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid project name "${name}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
      );
    }
    const projectPath = path.join(workdir, name);
    const phVersion = version ?? config.phVersion ?? getPhVersion();

    if (fs.existsSync(projectPath)) {
      const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
      const hasConfig = fs.existsSync(path.join(projectPath, 'powerhouse.config.json'));
      if (hasPackageJson && hasConfig) {
        return { text: `Project ${name} already exists at ${projectPath}` };
      }
      if (fs.existsSync(projectPath) && !hasPackageJson) {
        return { text: `Error: ${projectPath} exists but is missing config files` };
      }
    }

    const tags = ['dev', 'staging', 'latest'];
    const versionArgs = tags.includes(phVersion)
      ? [`--${phVersion}`]
      : ['--version', phVersion];
    const { success } = await runProcess(
      `ph init ${name} ${versionArgs.join(' ')} --pnpm`,
      { label: 'ph-init', timeout: 300_000, cwd: workdir, env: { FORCE_COLOR: '1' } },
    );

    if (!success) {
      return { text: `Failed to initialize project` };
    }

    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const hasConfig = fs.existsSync(path.join(projectPath, 'powerhouse.config.json'));
    if (hasPackageJson && hasConfig) {
      return { text: `Project ${name} initialized at ${projectPath}` };
    }
    return { text: `Project created but missing expected config files at ${projectPath}` };
  },
});
