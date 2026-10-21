import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { MCPClient } from '@mastra/mcp';
import { createSteerProcessor } from '@powerhousedao/clint-common/chat';
import { createMastraHelpers } from '@powerhousedao/ph-clint/mastra';
import { createWorkdirStore } from '@powerhousedao/ph-clint';
import type { AgentSetupContext, AgentProvider } from '@powerhousedao/ph-clint';
import type { WrapAgentOptions } from '@powerhousedao/ph-clint/mastra';
import { CLI_NAME } from '../config.js';
import type { Config } from '../framework.js';
import { VETRA_AGENT_IMAGE } from './agent-image.js';
import { INPUT_TOKEN_CAP, createLlmModels, resolveContextTokenLimit, resolveLlmSettings } from './llm.js';
import { createNoModelAgent } from './no-model-agent.js';
import { createReplayAgent } from './replay-agent.js';
import { bindRecorderContext } from '../lifecycle/check-recorder.js';
import { PauseProcessor, agentLogger } from './pause.js';
import { PhaseToolsProcessor } from './phase-tools.js';

/**
 * The main agent's sub-agents; Mastra exposes each as the tool `agent-<key>`
 * (the phase tool sets name them).
 */
export const SUB_AGENT_KEYS = ['agentDocumentModel', 'agentEditor', 'agentApp'] as const;
type SubAgentKey = (typeof SUB_AGENT_KEYS)[number];

/**
 * Agent factory for the CLI.
 *
 * Builds one Mastra Agent per sub-agent, then a main Agent that exposes them
 * via the `agents: { … }` field (Mastra surfaces each as a tool named
 * `agent-<key>`). Every model comes from OpenRouter (llm.ts); the OpenRouter
 * key is the only credential read. Without it the agent still serves, in
 * connect-a-model mode.
 */
export async function createAgent(ctx: AgentSetupContext<Config>): Promise<AgentProvider> {
  // The check recorder (a lifecycle tool wrap) reaches the product document
  // through the agent's command context.
  bindRecorderContext(ctx.context);

  // Deterministic e2e: replay a recorded tool sequence against the real
  // reactor instead of calling an LLM. Gated so it never affects production.
  const replayFixture = process.env.VETRA_REPLAY_FIXTURE;
  if (replayFixture) {
    ctx.context.log?.info(`[agent] replay mode — fixture ${replayFixture}`);
    return createReplayAgent(replayFixture, ctx);
  }

  const settings = resolveLlmSettings(ctx.config);
  if (!settings) {
    ctx.context.log?.info('[agent] No OpenRouter key (OPENROUTER_API_KEY) — serving in connect-a-model mode.');
    return createNoModelAgent();
  }
  const models = createLlmModels(settings);

  // Hard input-token ceiling at every step of the agentic loop: 80% of the
  // model's OpenRouter context_length (200k fallback), capped at
  // INPUT_TOKEN_CAP to bound per-step cost. Oldest messages are trimmed when
  // exceeded, so a long run degrades instead of failing with "prompt is too long".
  const [mainLimit, subLimit] = (
    await Promise.all([resolveContextTokenLimit(settings.model), resolveContextTokenLimit(settings.subagentModel)])
  ).map((limit) => Math.min(limit, INPUT_TOKEN_CAP));

  const m = createMastraHelpers(ctx);
  // Observer/Reflector model for observational memory — compresses long chat
  // histories into observation logs so sessions never hit the context limit.
  const memory = await m.createMemory({
    observationalMemory: { model: models.memory },
  });

  const agentDocumentModel = new Agent({
    id: 'agent-document-model',
    name: "Agent Document Model",
    description: "Assist in developing document model specifications",
    instructions: m.getAgentInstructions('agent-document-model'),
    model: models.subagent,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-document-model] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
    inputProcessors: [new TokenLimiterProcessor({ limit: subLimit })],
  });

  const agentEditor = new Agent({
    id: 'agent-editor',
    name: "Agent Editor",
    description: "Assists in developing document model editors",
    instructions: m.getAgentInstructions('agent-editor'),
    model: models.subagent,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-editor] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
    inputProcessors: [new TokenLimiterProcessor({ limit: subLimit })],
  });

  const agentApp = new Agent({
    id: 'agent-app',
    name: "Agent App",
    description: "Assists in developing drive-level apps (dashboards, kanban boards, custom drive views)",
    instructions: m.getAgentInstructions('agent-app'),
    model: models.subagent,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-app] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
    inputProcessors: [new TokenLimiterProcessor({ limit: subLimit })],
  });

  const subAgents: Record<SubAgentKey, Agent> = { agentDocumentModel, agentEditor, agentApp };

  const main = new Agent({
    id: 'vetra-agent',
    name: "Vetra Agent",
    instructions: m.getAgentInstructions('vetra-agent'),
    model: models.main,
    tools: async () => {
      ctx.context.log?.debug('[agent main] resolving tools');
      return m.getTools({ MCPClient });
    },
    workspace: await m.createWorkspace(),
    memory,
    agents: subAgents,
    // F17b: pause before steers are injected (a turn about to stop keeps its
    // steers for the next turn); the tool filter (only the active change's
    // current step's tools) before the token count. Steering is wired here
    // only — a sub-agent would take the session's steers.
    inputProcessors: [
      new PauseProcessor(ctx.context),
      createSteerProcessor(),
      new PhaseToolsProcessor(ctx.context),
      new TokenLimiterProcessor({ limit: mainLimit }),
    ],
  });

  // A pause aborts the turn through the processor workflow, which Mastra logs
  // as a failed step; this logger drops that line (a pause is not an error).
  main.__setLogger(agentLogger('Vetra Agent'));

  const store = createWorkdirStore(ctx.workdir, CLI_NAME);
  const wrapOpts: WrapAgentOptions = {
    // A first build (project → model → editor → app → preview) needs ~60–80
    // steps; at 40 the staging "create todo app product" run stopped before
    // preview (R20).
    maxSteps: 80,
    enableLogging: ctx.config.agentLogging,
    logDirectory: store.getStoreFolder('logs'),
    // No cacheControl here: ph-clint sends it as providerOptions.anthropic,
    // which the OpenRouter provider ignores. llm.ts requests Anthropic caching
    // (top-level cache_control) for anthropic/ models instead.
    image: VETRA_AGENT_IMAGE,
  };
  return m.wrapAgent(main, wrapOpts);
}
