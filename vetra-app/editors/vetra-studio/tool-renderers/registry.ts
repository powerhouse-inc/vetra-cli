import type { ComponentType } from "react";
import type { ToolRenderProps } from "./types.js";
import { ReadTool } from "./tools/ReadTool.js";
import { WriteTool } from "./tools/WriteTool.js";
import { EditTool } from "./tools/EditTool.js";
import { ListTool } from "./tools/ListTool.js";
import { GrepTool } from "./tools/GrepTool.js";
import { BashTool } from "./tools/BashTool.js";
import { SkillTool } from "./tools/SkillTool.js";
import { WhoamiTool } from "./tools/WhoamiTool.js";
import { SpecTool } from "./tools/SpecTool.js";
import { SpecPreviewTool } from "./tools/SpecPreviewTool.js";
import { ReactorProjectTool } from "./tools/ReactorProjectTool.js";
import { DeployEnvironmentTool } from "./tools/DeployEnvironmentTool.js";
import { AttachmentTool } from "./tools/AttachmentTool.js";
import { McpTool } from "./tools/McpTool.js";
import { WorkspaceTool } from "./tools/WorkspaceTool.js";

/** A component that renders one agent tool call/result. */
export type ToolComponent = ComponentType<ToolRenderProps>;

// Exact tool-name → component. One entry per alias; one component per tool.
const EXACT: Record<string, ToolComponent | undefined> = {
  Read: ReadTool,
  mastra_workspace_read_file: ReadTool,
  Write: WriteTool,
  mastra_workspace_write_file: WriteTool,
  Edit: EditTool,
  NotebookEdit: EditTool,
  mastra_workspace_edit_file: EditTool,
  mastra_workspace_list_files: ListTool,
  Grep: GrepTool,
  Glob: GrepTool,
  mastra_workspace_grep: GrepTool,
  Bash: BashTool,
  bash: BashTool,
  shell: BashTool,
  terminal: BashTool,
  mastra_workspace_execute_command: BashTool,
  skill: SkillTool,
  skill_read: SkillTool,
  whoami: WhoamiTool,
};

/**
 * Resolve the component for a tool. Exact match first, then family prefixes;
 * `undefined` means "no custom renderer" → clint-common's built-in default.
 * To customize a tool: edit its file in `tools/`; to add one: create the
 * component and map it here.
 */
export function resolveToolComponent(
  toolName: string,
): ToolComponent | undefined {
  const exact = EXACT[toolName];
  if (exact) return exact;

  if (toolName.includes("mcp__")) return McpTool;
  if (toolName.startsWith("spec-preview-")) return SpecPreviewTool;
  if (toolName.startsWith("spec-")) return SpecTool;
  if (toolName.startsWith("reactor-project-")) return ReactorProjectTool;
  if (toolName.startsWith("deploy-environment-")) return DeployEnvironmentTool;
  if (toolName.startsWith("attachment-")) return AttachmentTool;
  if (toolName.startsWith("mastra_workspace_")) return WorkspaceTool;

  return undefined;
}
