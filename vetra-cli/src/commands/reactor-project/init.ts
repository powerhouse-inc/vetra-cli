import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import { requireOption, formatProcessFailure } from '../../helpers/cli-errors.js';
import { ensureWorkspaceGitignore } from '../../helpers/workspace-git.js';
import { phInitNodeOptions } from '../../helpers/node-memory.js';
import { DEFAULT_PH_VERSION } from '../../constants.js';

const execFileAsync = promisify(execFile);
const NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

/** True when a `pnpm` bin resolves — used to prefer pnpm for fresh scaffolds.
 * Short timeout so a stalled corepack shim degrades to npm quickly. */
async function pnpmAvailable(): Promise<boolean> {
  try {
    await execFileAsync('pnpm', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

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
    const clonePath = config.reactorProjectClonePath;
    const phVersion = version ?? config.phVersion ?? DEFAULT_PH_VERSION;

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
      ? ['--tag', phVersion]
      : ['--version', phVersion];
    // ph-cmd dlx's the right ph-cli by version; ph-cli ignores --version when
    // --clone is set (the clone's lockfile wins) and just warns.

    // --clone requires pnpm (offline install from the clone's pnpm-lock.yaml).
    // Otherwise honor the configured PM, else prefer pnpm when present (ph infers npm).
    let pm = config.packageManager as string | undefined;
    if (!clonePath && !pm && (await pnpmAvailable())) pm = 'pnpm';
    const pmArgs = pm ? ['--package-manager', pm] : [];
    const initArgs = clonePath
      ? `${versionArgs.join(' ')} --pnpm --clone ${clonePath}`
      : [...versionArgs, ...pmArgs].join(' ');
    const command = `ph init ${name} ${initArgs}`;
    const { success, output } = await runProcess(command, {
      label: 'ph-init',
      timeout: 300_000,
      cwd: workdir,
      env: { FORCE_COLOR: '1', NODE_OPTIONS: phInitNodeOptions() },
    });

    if (!success) {
      throw new Error(formatProcessFailure('ph init failed', command, workdir, output));
    }

    fs.rmSync(path.join(projectPath, '.git'), { recursive: true, force: true });

    if (!fs.existsSync(path.join(workdir, '.git'))) {
      const gitInit = await runProcess('git init -q', {
        label: 'git-init',
        cwd: workdir,
        timeout: 30_000,
      });
      if (!gitInit.success) {
        throw new Error(
          formatProcessFailure('git init failed', 'git init -q', workdir, gitInit.output),
        );
      }
    }

    ensureWorkspaceGitignore(workdir);

    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const hasConfig = fs.existsSync(path.join(projectPath, 'powerhouse.config.json'));
    if (hasPackageJson && hasConfig) {
      if (clonePath) seedVendorCache(clonePath, projectPath);
      return { text: `Project ${name} initialized at ${projectPath}` };
    }
    return { text: `Project created but missing expected config files at ${projectPath}` };
  },
});

// ph init --clone reinstalls node_modules from the lockfile, dropping the baked
// .ph-vendor; reseed it from the template so ph vetra warm-hits (digest match).
function seedVendorCache(clonePath: string, projectPath: string): void {
  const src = path.join(clonePath, 'node_modules', '.ph-vendor');
  const nodeModules = path.join(projectPath, 'node_modules');
  if (!fs.existsSync(path.join(src, 'import-map.json')) || !fs.existsSync(nodeModules)) return;
  try {
    const dest = path.join(nodeModules, '.ph-vendor');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
  } catch {
    // best-effort warm cache; ph vetra rebuilds on a miss
  }
}
