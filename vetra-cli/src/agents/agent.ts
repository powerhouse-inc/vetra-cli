import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { MCPClient } from '@mastra/mcp';
import { createMastraHelpers } from '@powerhousedao/ph-clint/mastra';
import { createWorkdirStore } from '@powerhousedao/ph-clint';
import type { AgentSetupContext, AgentProvider } from '@powerhousedao/ph-clint';
import type { WrapAgentOptions } from '@powerhousedao/ph-clint/mastra';
import {
  createClaudeSubscriptionModel,
  createUserTokenStore,
  resolveClaudeAgentModel,
} from '@powerhousedao/ph-clint-claude-subscription';
import { CLI_NAME } from '../config.js';
import type { Config } from '../framework.js';
import { createDemoAgent } from './demo-agent.js';

const SUB_AGENT_MODEL_ID = 'anthropic/claude-sonnet-4-5';

/**
 * Hard input-token ceiling enforced at every step of the agentic loop.
 * Backstop under the 200k Anthropic window (leaves headroom for tool
 * schemas and output); oldest messages are trimmed when exceeded so a
 * long run degrades instead of failing with "prompt is too long".
 */
const INPUT_TOKEN_LIMIT = 160_000;

/**
 * Agent factory for the CLI.
 *
 * Builds one Mastra Agent per sub-agent, then a main Agent that exposes them
 * via the `agents: { … }` field (Mastra surfaces each as a tool named
 * `agent-<key>`). Auth precedence: API key, then Claude.ai subscription
 * session (`claude-login`, user scope), then the demo agent.
 */
export async function createAgent(ctx: AgentSetupContext<Config>): Promise<AgentProvider> {
  const resolved = await resolveClaudeAgentModel({
    store: createUserTokenStore({ cliName: CLI_NAME }),
    modelId: ctx.config.model,
    anthropicApiKey: ctx.config.anthropicApiKey,
  });
  if (resolved.kind === 'none') {
    ctx.context.log?.info(
      '[agent] No API key and no Claude subscription session — run `claude-login` to authenticate.',
    );
    return createDemoAgent();
  }
  const subAgentModel =
    resolved.kind === 'subscription'
      ? await createClaudeSubscriptionModel({
          session: resolved.session,
          modelId: SUB_AGENT_MODEL_ID,
        })
      : { id: SUB_AGENT_MODEL_ID, apiKey: ctx.config.anthropicApiKey! } as const;

  // Observer/Reflector model for observational memory — compresses long chat
  // histories into observation logs so sessions never hit the context limit.
  const memoryModel =
    resolved.kind === 'subscription'
      ? await createClaudeSubscriptionModel({
          session: resolved.session,
          modelId: ctx.config.memoryModel,
        })
      : { id: ctx.config.memoryModel, apiKey: ctx.config.anthropicApiKey! } as const;

  const m = createMastraHelpers(ctx);
  const memory = await m.createMemory({
    observationalMemory: { model: memoryModel },
  });

  const agentDocumentModel = new Agent({
    id: 'agent-document-model',
    name: "Agent Document Model",
    description: "Assist in developing document model specifications",
    instructions: m.getAgentInstructions('agent-document-model'),
    model: subAgentModel,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-document-model] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
    inputProcessors: [new TokenLimiterProcessor({ limit: INPUT_TOKEN_LIMIT })],
  });

  const agentEditor = new Agent({
    id: 'agent-editor',
    name: "Agent Editor",
    description: "Assists in developing document model editors",
    instructions: m.getAgentInstructions('agent-editor'),
    model: subAgentModel,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-editor] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
    inputProcessors: [new TokenLimiterProcessor({ limit: INPUT_TOKEN_LIMIT })],
  });

  const agentApp = new Agent({
    id: 'agent-app',
    name: "Agent App",
    description: "Assists in developing drive-level apps (dashboards, kanban boards, custom drive views)",
    instructions: m.getAgentInstructions('agent-app'),
    model: subAgentModel,
    tools: async () => {
      ctx.context.log?.debug(`[agent agent-app] resolving tools`);
      return m.getTools({ MCPClient, include: [] });
    },
    memory,
  });

  const subAgents: Record<string, Agent> = { agentDocumentModel, agentEditor, agentApp };

  const main = new Agent({
    id: 'vetra-agent',
    name: "Vetra Agent",
    instructions: m.getAgentInstructions('vetra-agent'),
    model: resolved.model,
    tools: async () => {
      ctx.context.log?.debug('[agent main] resolving tools');
      return m.getTools({ MCPClient });
    },
    workspace: await m.createWorkspace(),
    memory,
    agents: subAgents,
    inputProcessors: [new TokenLimiterProcessor({ limit: INPUT_TOKEN_LIMIT })],
  });

  const store = createWorkdirStore(ctx.workdir, CLI_NAME);
  const wrapOpts: WrapAgentOptions = {
    maxSteps: 80,
    enableLogging: ctx.config.agentLogging,
    logDirectory: store.getStoreFolder('logs'),
    cacheControl: true,
    image: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMzEiIGZpbGw9Im5vbmUiIGNsYXNzPSJoaWRkZW4gaC04IG1kOmJsb2NrIj48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik0xNDAuNDIgNC4xN2MuNDEyIDAgLjc4My4yNTMuOTMzLjYzOGw4LjQ4NSAyMS44MjdhMSAxIDAgMCAxLS45MzMgMS4zNjJoLTMuNzczYy0uNDE2IDAtLjc4OS0uMjU4LS45MzYtLjY0N2wtMS40ODMtMy45NC0xLjc4Ny00LjgyNS0yLjY4MS03LjA4OC0yLjI5OCA2LjA3NWgyLjg3NGMuNjkyIDAgMS4xNzUuNjg2Ljk0MyAxLjMzN2wtMS4xNDggMy4yMTJhMSAxIDAgMCAxLS45NDEuNjY0aC0zLjY2NmwtLjIzMi42MjUtMS40ODMgMy45NGMtLjE0Ny4zODktLjUyLjY0Ny0uOTM2LjY0N2gtMy44MDVhMSAxIDAgMCAxLS45MzMtMS4zNjFsOC40NTktMjEuODI3YTEgMSAwIDAgMSAuOTMyLS42NHpNMTA0LjUxNyAyNy45OTdhMSAxIDAgMCAxLTEtMVY1LjE3YTEgMSAwIDAgMSAxLTFoMTEuOTU2YzQuNTU3IDAgNy43NDQgMy4wOTcgNy43NDQgNy41MzUgMCAzLjMzNi0xLjkzNiA2LjA0Ny00Ljg4NCA3LjExOWw0Ljk3NyA3LjYyN2ExIDEgMCAwIDEtLjgzOCAxLjU0NmgtNC4xNTdhMSAxIDAgMCAxLS44NDMtLjQ2M2wtNS4xODYtOC4xNDRoLTMuOTYxdjcuNjA3YTEgMSAwIDAgMS0xIDF6bTQuODA4LTEzLjgyaDYuNzkxYzEuMzcgMCAyLjI5My0uOTgyIDIuMjkzLTIuMzgyIDAtMS40My0uOTIzLTIuNDEzLTIuMjkzLTIuNDEzaC02Ljc5MXpNOTAuMDI2IDI3Ljk5N2ExIDEgMCAwIDEtMS0xVjkuMzgyaC02LjA0OWExIDEgMCAwIDEtLjkyLTEuMzk0bDEuMzc3LTMuMjEyYTEgMSAwIDAgMSAuOTItLjYwNmgxNi4xODFhMSAxIDAgMCAxIDEgMXYzLjIxMmExIDEgMCAwIDEtMSAxaC01LjczMXYxNy42MTVhMSAxIDAgMCAxLTEgMXpNNjYuNTA0IDI3Ljk5N2ExIDEgMCAwIDEtMS0xVjUuMTdhMSAxIDAgMCAxIDEtMWgxMy42NTdhMSAxIDAgMCAxIC45MiAxLjM5NGwtMS4zNzcgMy4yMTJhMSAxIDAgMCAxLS45MTkuNjA2aC03LjQ3MWwtLjAwMiAzLjg0Mmg0LjkxYTEgMSAwIDAgMSAuOTM5IDEuMzQ2bC0xLjEzOSAzLjA5M2ExIDEgMCAwIDEtLjkzOC42NTRoLTMuNzcydjQuNTg3aDguNjJhMSAxIDAgMCAxIDEgMXYzLjA5M2ExIDEgMCAwIDEtMSAxek01MC40MjUgMjcuOTk3YTEgMSAwIDAgMS0uOTMyLS42MzhMNDEuMDM0IDUuNTNhMSAxIDAgMCAxIC45MzMtMS4zNjFoMy44MDZhMSAxIDAgMCAxIC45MzUuNjQ2bDUuMDE2IDEzLjIzN2MuMzI2Ljg2MSAxLjU0NC44NjEgMS44NyAwbDUuMDE1LTEzLjIzN2ExIDEgMCAwIDEgLjkzNS0uNjQ2aDMuNzc1YTEgMSAwIDAgMSAuOTMyIDEuMzYyTDU1Ljc2NiAyNy4zNmExIDEgMCAwIDEtLjkzMi42Mzd6Ij48L3BhdGg+PHBhdGggZmlsbD0iIzM4Qzc4MCIgZD0iTTAgMTguNDgyYzAtMS4yMy45OTgtMi4yMjggMi4yMjgtMi4yMjhoMS4zNTNjNi4xNTMgMCAxMS4xNCA0Ljk4OCAxMS4xNCAxMS4xNHYxLjM1NGMwIDEuMjMtLjk5NyAyLjIyOC0yLjIyNyAyLjIyOEgyLjIyOEEyLjIzIDIuMjMgMCAwIDEgMCAyOC43NDh6TTAgMi4yMjhDMCAuOTk4Ljk5OCAwIDIuMjI4IDBoMTAuMjY2YzEuMjMgMCAyLjIyOC45OTggMi4yMjggMi4yMjh2MS4zNTNjMCA2LjE1My00Ljk4OCAxMS4xNC0xMS4xNDEgMTEuMTRIMi4yMjhBMi4yMyAyLjIzIDAgMCAxIDAgMTIuNDk1ek0xNi4yNTQgMjcuMzk1YzAtNi4xNTMgNC45ODgtMTEuMTQxIDExLjE0LTExLjE0MWgxLjM1NGMxLjIzIDAgMi4yMjguOTk3IDIuMjI4IDIuMjI4djEwLjI2NmMwIDEuMjMtLjk5OCAyLjIyOC0yLjIyOCAyLjIyOEgxOC40ODJhMi4yMyAyLjIzIDAgMCAxLTIuMjI4LTIuMjI4ek0xNi4yNTQgMi4yMjhDMTYuMjU0Ljk5OCAxNy4yNSAwIDE4LjQ4MiAwaDEwLjI2NmMxLjIzIDAgMi4yMjguOTk4IDIuMjI4IDIuMjI4djEwLjI2NmMwIDEuMjMtLjk5OCAyLjIyOC0yLjIyOCAyLjIyOGgtMS4zNTNjLTYuMTUzIDAtMTEuMTQxLTQuOTg4LTExLjE0MS0xMS4xNDF6Ij48L3BhdGg+PC9zdmc+",
  };
  return m.wrapAgent(main, wrapOpts);
}
