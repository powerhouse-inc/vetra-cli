/**
 * CLI definition: the `Cli` the package exports as ./cli (cli/index.ts).
 * The @clint:begin/@clint:end markers have no generator; they are comments.
 */
// @clint:begin imports
import { defineCli } from '@powerhousedao/clint';
import { z } from 'zod';
import path from 'node:path';
import { CLI_NAME, CLI_VERSION, CLI_ROOT } from './config.js';
import { configSchema, secretsSchema } from './framework.js';
import { lazyTrigger } from './lazy.js';
import { STUDIO_FILES } from './helpers/studio-paths.js';
import { agentRun } from './commands/agent-run.js';
import { specCommands } from './commands/spec/index.js';
import { specPreviewCommands } from './commands/spec-preview/index.js';
import { deployCommands } from './commands/deploy/index.js';
import { authCommands } from './commands/auth/index.js';
import { reactorProjectCommands } from './commands/reactor-project/index.js';
import { projectHostCommands } from './commands/project-hosts/index.js';
import { productCommands } from './commands/product/index.js';
import { reactorProject } from './services/reactor-project.js';
import { genGuard } from './lifecycle/gen-guard.js';
import { shellGuard } from './lifecycle/shell-guard.js';
import { tsCheck } from './lifecycle/ts-check.js';
import { serializableToolErrors } from './lifecycle/tool-errors.js';
import { agentRequiredInputs } from './lifecycle/agent-required-inputs.js';
import { checkRecorder } from './lifecycle/check-recorder.js';
// @clint:end imports
import { createAttachmentCommands } from '@powerhousedao/clint/powerhouse';
import { githubCommands } from './commands/github/index.js';

// Every model the reactor client reduces and signs with, each once: the
// package's own, @powerhousedao/vetra's spec documents, clint-common's.
// Loaded when a command attaches.
async function studioDocumentModels() {
  const [{ StudioProductV1 }, vetra, common] = await Promise.all([
    import('document-models'),
    import('@powerhousedao/vetra'),
    import('@powerhousedao/clint-common'),
  ]);
  return [StudioProductV1, ...vetra.documentModels, ...common.documentModels];
}

export const cli = defineCli({
  name: CLI_NAME,
  version: CLI_VERSION,
  description: `${CLI_NAME} v${CLI_VERSION}`,
  configSchema,
  secretsSchema,

  // @clint:begin commands
  commands: [
    ...specCommands,
    ...specPreviewCommands,
    ...deployCommands,
    ...authCommands,
    ...reactorProjectCommands,
    ...projectHostCommands,
    ...productCommands,
    ...createAttachmentCommands(),
    agentRun,
    ...githubCommands,
  ],
  // @clint:end commands

  // @clint:begin services
  services: [reactorProject],
  // @clint:end services

  // @clint:begin triggers
  // Each loads when the routine sets it up (lazy.ts).
  triggers: [
    // Files from chat messages go to the Cli's folder, not the project's tree.
    lazyTrigger('chat-session-watch', async () =>
      (await import('@powerhousedao/clint-common/chat')).createChatSessionWatchTrigger({
        downloadsDir: STUDIO_FILES.downloads,
      }),
    ),
    lazyTrigger('drive-layout', async () => (await import('./triggers/drive-layout.js')).driveLayoutTrigger),
    lazyTrigger('preview-server', async () => (await import('./triggers/preview-server.js')).previewServerTrigger),
    lazyTrigger('preview-run', async () => (await import('./triggers/preview-run.js')).previewRunTrigger),
    lazyTrigger('runtime-spec-sync', async () => (await import('./triggers/runtime-spec-sync.js')).runtimeSpecSyncTrigger),
    lazyTrigger('studio-url', async () => (await import('./triggers/studio-url.js')).studioUrlTrigger),
    lazyTrigger('product-supervisor', async () => (await import('./product/supervisor.js')).productSupervisorTrigger),
    lazyTrigger('product-requests', async () => (await import('./triggers/product-requests.js')).productRequestsTrigger),
    lazyTrigger('live-health', async () => (await import('./triggers/live-health.js')).liveHealthTrigger),
  ],
  // @clint:end triggers

  // @clint:begin prompts
  prompts: {
    // `ph run cli build` (part of `pnpm build`) writes dist/skills/{skills,agent-profiles}.
    artifacts: [path.join(CLI_ROOT, 'dist', 'skills', 'skills')],
    agents: {
      'vetra-agent': {
        name: 'vetra-agent',
        sections: ['base.md', 'tools.md', 'workflow.md'],
        skills: ['reactor-project-management', 'document-modeling', 'document-editor-creation', 'drive-app-creation', 'deploy', 'product-specs', 'example-data'],
      },
      'agent-document-model': {
        name: 'agent-document-model',
        sections: ['base.md', 'tools.md'],
        skills: ['document-modeling'],
      },
      'agent-editor': {
        name: 'agent-editor',
        sections: ['base.md', 'tools.md'],
        skills: ['document-editor-creation'],
      },
      'agent-app': {
        name: 'agent-app',
        sections: ['base.md', 'tools.md'],
        skills: ['drive-app-creation'],
      },
    },
    skills: {
      'deploy': {
        description: 'Only for an explicit request to deploy to a named environment (Studio products go live by themselves). Build, publish, and deploy a Reactor package to a Vetra Cloud environment — reuse or create an environment, install the package, return the live links, and answer deployment status questions (is the package published, installed, or the environment ready).',
        inputSchema: z.object({
          mode: z
            .enum(['expert', 'discovery', 'one-shot'])
            .default('expert')
            .describe(
              'Expert: align technical design decisions between fellow experts. Discovery: explain the process and guide non-expert users to decisions. One-shot: make all design decisions autonomously and execute without asking',
            ),
        }),
        instructionTemplate:
          'Use your {{skillId}} skill in {{mode}} mode for: {{prompt}}',
      },
      'example-data': {
        description: 'Tests step: write the product\'s example documents (seed/<document-type>.json, names starting "Example — delete me") from the preview sample data. They fill the live product the first time it launches and are checked with the preview smoke check. Ends the step with `product-progress suggest` (2–3 next improvements).',
      },
      'product-specs': {
        description: 'Create and refine product specs in the project — brand, problem and audience sheets, features and their work breakdown structure (ordering, outcome links, feature bets, WBS tasks). For a product/app request, write them alongside the build, never instead of it.',
      },
      'reactor-project-management': {
        description: "Start (when its run is on), build, and publish the Reactor Package project Studio runs in",
        inputSchema: z.object({
          mode: z
            .enum(['expert', 'discovery', 'one-shot'])
            .default('expert')
            .describe(
              'Expert: align technical design decisions between fellow experts. Discovery: explain the process and guide non-expert users to decisions. One-shot: make all design decisions autonomously and execute without asking',
            ),
        }),
        instructionTemplate:
          'Use your {{skillId}} skill in {{mode}} mode for: {{prompt}}',
      },
      'document-modeling': {
        description: 'Design Powerhouse document models with state schemas, operations, and reducers',
        inputSchema: z.object({
          mode: z
            .enum(['expert', 'discovery', 'one-shot'])
            .default('expert')
            .describe(
              'Expert: align technical design decisions between fellow experts. Discovery: explain the process and guide non-expert users to decisions. One-shot: make all design decisions autonomously and execute without asking',
            ),
        }),
        instructionTemplate:
          'Use your {{skillId}} skill in {{mode}} mode for: {{prompt}}',
      },
      'document-editor-creation': {
        description: 'Build React editor components for Powerhouse document types, then preview them with sample data in the BUILD pane',
        inputSchema: z.object({
          mode: z
            .enum(['expert', 'discovery', 'one-shot'])
            .default('expert')
            .describe(
              'Expert: align technical design decisions between fellow experts. Discovery: explain the process and guide non-expert users to decisions. One-shot: make all design decisions autonomously and execute without asking',
            ),
        }),
        instructionTemplate:
          'Use your {{skillId}} skill in {{mode}} mode for: {{prompt}}',
      },
      'drive-app-creation': {
        description: 'Build drive-level app components (dashboards, kanban boards, custom drive views) for Powerhouse drives',
        inputSchema: z.object({
          mode: z
            .enum(['expert', 'discovery', 'one-shot'])
            .default('expert')
            .describe(
              'Expert: align technical design decisions between fellow experts. Discovery: explain the process and guide non-expert users to decisions. One-shot: make all design decisions autonomously and execute without asking',
            ),
        }),
        instructionTemplate:
          'Use your {{skillId}} skill in {{mode}} mode for: {{prompt}}',
      },
    },
  },
  // @clint:end prompts

  // @clint:begin events
  events: {
    'service:pattern-matched': (event, log) => {
      log.info(`  ✓ ${event.patternName} matched (${event.remaining} remaining)`);
    },
    'service:ready': (event, log) => {
      const ep = event.endpoints ?? {};
      log.info(
        `✓ ${event.name} is ready` +
          (ep['vetra-studio'] ? ` — Preview at ${ep['vetra-studio']}` : ''),
      );
    },
    'service:failed': (event, log) => {
      log.error(`✗ ${event.name} failed: ${event.error}`);
      if (event.id === 'reactor-project' && /exited .*before writing its run record/.test(event.error ?? '')) {
        log.info(
          "  Hint: the Preview run stopped while starting; reactor-project-logs shows why.",
        );
      }
      if (/max instances/.test(event.error ?? '')) {
        log.info(
          `  Hint: ${event.name} is already running. Stop it first with ${event.id}-stop, or use ${event.id}-restart.`,
        );
      }
    },
    'service:restarting': (event, log) => {
      log.warn(`↻ ${event.name} restarting (attempt ${event.attempt}/${event.maxRetries})`);
    },
    'service:stopped': (event, log) => {
      log.info(`■ ${event.name} stopped`);
    },
  },
  // @clint:end events

  // @clint:begin lifecycle
  lifecycle: [
    genGuard(),
    // The shell is for installs: checks, builds and git go through recorded tools.
    shellGuard(),
    tsCheck(),
    // The agent's tool schemas mark the spec inputs it can't leave out.
    agentRequiredInputs(),
    // Records spec-generate / reactor-project-check outcomes as check runs on
    // the product's active change. Inside tool-errors so its rethrows keep
    // their serializable message.
    checkRecorder(),
    // Outermost wrap: thrown tool errors keep their message through JSON
    // serialization to the model. Must stay last to catch inner hooks' throws.
    serializableToolErrors(),
  ],
  // @clint:end lifecycle

  // @clint:begin interactive
  interactive: {
    welcome: ({ workdir }) =>
      [
        `${CLI_NAME} v${CLI_VERSION}`,
        `Workdir: ${workdir}`,
        '',
        'Type a message to talk to the agent, or / for commands.',
      ].join('\n'),
  },
  // @clint:end interactive
});

// @clint:begin reactor
// The Cli attaches to a running switchboard: a host runner (or the bin, from
// the project's running Studio or VETRA_SWITCHBOARD_URL) hands it the drive
// address and the reactor holds
// `remote`, built at attach: a cloud Studio adds the agent's Renown identity
// (auth/studio-identity.ts), a local one writes unsigned.
cli.configureReactor({
  create: async () => {
    throw new Error(
      `${CLI_NAME} attaches to a switchboard: start Studio in this project (ph vetra) and run this again, or set VETRA_SWITCHBOARD_URL to a drive address (<switchboard>/d/<slug>).`,
    );
  },
  remote: async (setup) => {
    const { studioIdentity } = await import('./auth/studio-identity.js');
    return {
      documentModels: await studioDocumentModels(),
      drive: { name: 'Home', preferredEditor: 'vetra-studio' },
      subscriptions: {},
      ...(await studioIdentity(setup)),
    };
  },
});
// @clint:end reactor

// A command that runs in the Studio signs as the person who typed it: its
// actions are signed in that process (auth/caller-session.ts), loaded on the
// first signature.
cli.configureIdentity({
  label: 'vetra',
  open: async (o) => (await import('./auth/caller-session.js')).openCallerSession(o),
});

// @clint:begin mastra
// Mastra and the agent definitions load at the first chat or agent run.
cli.configureAgent(async (ctx) => (await import('./agents/agent.js')).createAgent(ctx));
// @clint:end mastra
