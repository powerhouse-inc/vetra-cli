import { z } from 'zod';
import { defineCommand } from '../../framework.js';
import { fetchBotUserId, resolveRepoRemote, shq } from '../../helpers/github.js';

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
    const { token, repoFullName, remoteUrl } = await resolveRepoRemote(config);

    const slug = config.githubAppSlug;
    const botUserId = await fetchBotUserId(slug);
    const botName = `${slug}[bot]`;
    const botEmail = `${botUserId}+${slug}[bot]@users.noreply.github.com`;

    const steps: Array<{ label: string; command: string }> = [
      { label: 'git-init', command: 'git init -q' },
      {
        label: 'git-commit',
        command: `git add -A && (git diff --cached --quiet || git -c user.name=${shq(
          botName,
        )} -c user.email=${shq(botEmail)} commit -q -m ${shq(message)})`,
      },
      {
        label: 'git-push',
        command: `git push ${shq(remoteUrl)} ${shq(`HEAD:refs/heads/${branch}`)}`,
      },
    ];

    for (const step of steps) {
      const { success, output } = await runProcess(step.command, {
        label: step.label,
        cwd: workdir,
        timeout: 120_000,
      });
      if (!success) {
        const safe = output.split(token).join('***');
        throw new Error(`${step.label} failed: ${safe}`);
      }
    }

    return { text: `Pushed ${repoFullName} (${branch}) as ${botName}.` };
  },
});
