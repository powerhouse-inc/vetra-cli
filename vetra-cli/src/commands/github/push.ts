import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import {
  authedGit,
  fetchBotUserId,
  GH_TOKEN_ENV,
  resolveRepoRemote,
  shq,
} from '../../helpers/github.js';
import { ensureWorkspaceGitignore } from '../../helpers/workspace-git.js';

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

const inputSchema = z.object({
  branch: z.string().default('main').describe('Remote branch to push to'),
  message: z
    .string()
    .default('Update from Vetra Studio')
    .describe('Commit message for the pushed changes'),
});

export const githubPush = defineCommand({
  id: 'github-push',
  description:
    'Commit the workspace and push it to the GitHub repo connected to this studio environment, as the Vetra bot.',
  inputSchema,
  execute: async ({ branch, message }, { workdir, config, runProcess }) => {
    if (!BRANCH_PATTERN.test(branch)) {
      throw new Error(`Invalid branch name "${branch}".`);
    }
    const { token, repoFullName, cleanUrl } = await resolveRepoRemote({ workdir, config });
    ensureWorkspaceGitignore(workdir);

    const slug = config.githubAppSlug;
    const botUserId = await fetchBotUserId(slug);
    const botName = `${slug}[bot]`;
    const botEmail = `${botUserId}+${slug}[bot]@users.noreply.github.com`;
    const git = authedGit();

    const steps: { label: string; command: string }[] = [
      { label: 'git-init', command: 'git init -q' },
      {
        label: 'git-commit',
        command: `git add -A -- . ${shq(':(exclude).ph')} && (git diff --cached --quiet || git -c user.name=${shq(
          botName,
        )} -c user.email=${shq(botEmail)} commit -q -m ${shq(message)})`,
      },
      {
        label: 'git-push',
        command: `${git} push ${shq(cleanUrl)} ${shq(`HEAD:refs/heads/${branch}`)}`,
      },
    ];

    for (const step of steps) {
      const { success, output } = await runProcess(step.command, {
        label: step.label,
        cwd: workdir,
        timeout: 120_000,
        env: { [GH_TOKEN_ENV]: token },
      });
      if (!success) {
        const safe = output.split(token).join('***');
        throw new Error(`${step.label} failed: ${safe}`);
      }
    }

    return { text: `Pushed ${repoFullName} (${branch}) as ${botName}.` };
  },
});
