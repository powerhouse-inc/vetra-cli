import { Agent } from '@mastra/core/agent';
import { MCPClient } from '@mastra/mcp';
import { createMastraHelpers } from '@powerhousedao/ph-clint/mastra';
import { createWorkdirStore } from '@powerhousedao/ph-clint';
import type { AgentSetupContext, AgentProvider } from '@powerhousedao/ph-clint';
import type { WrapAgentOptions } from '@powerhousedao/ph-clint/mastra';
import { CLI_NAME } from '../config.js';
import type { Config } from '../framework.js';
import { createDemoAgent } from './demo-agent.js';

/**
 * Agent factory for the CLI.
 *
 * Builds one Mastra Agent per sub-agent, then a main Agent that exposes them
 * via the `agents: { … }` field (Mastra surfaces each as a tool named
 * `agent-<key>`). Returns a demo agent when no API key is configured.
 */
export async function createAgent(ctx: AgentSetupContext<Config>): Promise<AgentProvider> {
  if (!ctx.config.anthropicApiKey) return createDemoAgent();

  const m = createMastraHelpers(ctx);
  const memory = await m.createMemory();

  const main = new Agent({
    id: 'vetra-agent',
    name: "Vetra Agent",
    instructions: m.getAgentInstructions('vetra-agent'),
    model: ctx.config.anthropicApiKey
      ? { id: ctx.config.model as `${string}/${string}`, apiKey: ctx.config.anthropicApiKey }
      : (ctx.config.model as `${string}/${string}`),
    tools: async () => {
      ctx.context.log?.debug('[agent main] resolving tools');
      return m.getTools({ MCPClient });
    },
    workspace: await m.createWorkspace(),
    memory,
  });

  const store = createWorkdirStore(ctx.workdir, CLI_NAME);
  const wrapOpts: WrapAgentOptions = {
    maxSteps: 80,
    enableLogging: ctx.config.agentLogging,
    logDirectory: store.getStoreFolder('logs'),
    cacheControl: true,
  };
  return m.wrapAgent(main, wrapOpts);
}
