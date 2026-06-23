import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import { resolveRepoRemote, shq } from '../../helpers/github.js';

const inputSchema = z.object({});

export const githubClone = defineCommand({
  id: 'github-clone',
  description:
    'Clone the GitHub repo connected to this studio environment into the workspace, for a fresh (non-persisted) environment.',
  inputSchema,
  execute: async (_input, { workdir, config, runProcess }) => {
    const { token, repoFullName, remoteUrl } = await resolveRepoRemote({ workdir, config });
    const cleanUrl = `https://github.com/${repoFullName}.git`;

    const steps: { label: string; command: string }[] = [
      { label: 'git-clone', command: `git clone ${shq(remoteUrl)} .` },
      { label: 'git-remote', command: `git remote set-url origin ${shq(cleanUrl)}` },
    ];

    for (const step of steps) {
      const { success, output } = await runProcess(step.command, {
        label: step.label,
        cwd: workdir,
        timeout: 300_000,
      });
      if (!success) {
        const safe = output.split(token).join('***');
        throw new Error(`${step.label} failed: ${safe}`);
      }
    }

    return { text: `Cloned ${repoFullName} into the workspace.` };
  },
});
