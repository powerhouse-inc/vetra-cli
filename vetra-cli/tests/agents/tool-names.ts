import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFilesystem, LocalSandbox, Workspace, createSkillTools, createWorkspaceTools } from '@mastra/core/workspace';

/**
 * The main agent's real tool names: the cli's commands (skills are served by
 * the skill tool, not as commands), the workspace and skill tools Mastra adds,
 * and one `agent-<key>` tool per sub-agent.
 */
export async function registeredToolNames(): Promise<string[]> {
  const { cli } = await import('../../src/cli.js');
  const { SUB_AGENT_KEYS } = await import('../../src/agents/agent.js');
  const skillIds = new Set(Object.keys(cli.getMetadata().prompts?.skills ?? {}));
  const commands = cli
    .listCommands()
    .map((c) => c.id)
    .filter((id) => !skillIds.has(id));
  const dir = mkdtempSync(path.join(tmpdir(), 'phase-tools-'));
  try {
    const workspace = new Workspace({
      filesystem: new LocalFilesystem({ basePath: dir }),
      sandbox: new LocalSandbox({ workingDirectory: dir }),
    });
    const workspaceTools = Object.keys(await createWorkspaceTools(workspace));
    const skillTools = Object.keys(createSkillTools(undefined as never));
    // The running project's reactor MCP tools are discovered at runtime as
    // `${service.id}-mcp__<tool>`; one stands in for them here.
    const mcpTools = ['reactor-project-mcp__addActions'];
    return [
      ...commands,
      ...workspaceTools,
      ...skillTools,
      ...SUB_AGENT_KEYS.map((k) => `agent-${k}`),
      ...mcpTools,
    ];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
