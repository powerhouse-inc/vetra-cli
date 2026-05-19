import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createProcessManager } from '@powerhousedao/ph-clint';
import { defineCommand } from '../../framework.js';
import { resolveReactorProjectPath } from '../../helpers/project.js';

export interface BuildResult {
  success: boolean;
}

/**
 * Run `ph build` in the given project directory.
 * Streams output via the `onData` callback.
 */
export async function runBuild(
  projectPath: string,
  onData?: (chunk: string) => void,
): Promise<BuildResult> {
  const pm = createProcessManager();
  const { success } = await pm.run('ph build', {
    label: 'ph-build',
    timeout: 120_000,
    cwd: projectPath,
    env: { FORCE_COLOR: '1' },
    onOutput: onData ? (line) => onData(line + '\n') : undefined,
  });
  return { success };
}

const inputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      'Project directory name (relative to workdir). Only needed when the workdir is not already a Reactor package project.',
    ),
  log: z
    .boolean()
    .optional()
    .describe('Whether to log build output to the console. Defaults to false.'),
});

export const reactorProjectBuild = defineCommand({
  id: 'reactor-project-build',
  description: 'Build a Reactor package project (runs ph build)',
  inputSchema,
  execute: async ({ name }, { workdir, runProcess }) => {
    const projectPath = resolveReactorProjectPath(workdir, name);

    const { success } = await runProcess('ph build', {
      label: 'ph-build',
      timeout: 120_000,
      cwd: projectPath,
      env: { FORCE_COLOR: '1' },
    });

    if (!success) {
      return { text: `**Build failed**` };
    }

    const hasDistDir = fs.existsSync(path.join(projectPath, 'dist'));
    if (hasDistDir) {
      return {
        text: `**Build successful** — output at \`${path.join(name || '.', 'dist')}\``,
      };
    }
    return { text: `**Build completed** (exit code 0)` };
  },
});
