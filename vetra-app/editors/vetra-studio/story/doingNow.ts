/**
 * The story's live "doing now" sub-line (spec §5.4): the agent's current tool
 * call in plain words — "writing QueueBoard.tsx…", "running the checks…",
 * "starting the preview…". The tool ids are the ones `vetraToolRenderers`
 * knows; anything else reads as plain work, never as a tool name.
 */

/** The agent's newest tool call: its tool id and parsed arguments. */
export type ToolCallView = {
  toolName: string;
  args: unknown;
};

export const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "NotebookEdit",
  "mastra_workspace_write_file",
  "mastra_workspace_edit_file",
]);
export const READ_TOOLS = new Set(["Read", "mastra_workspace_read_file"]);
export const SEARCH_TOOLS = new Set([
  "Grep",
  "Glob",
  "mastra_workspace_grep",
  "mastra_workspace_list_files",
]);
export const SHELL_TOOLS = new Set([
  "Bash",
  "bash",
  "shell",
  "terminal",
  "mastra_workspace_execute_command",
]);

/** Shell commands that run the project's checks. */
export const CHECK_COMMAND = /\b(tsc|lint|vitest|test|check)\b/;

function record(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The file name (no folders) a tool call works on, if any. */
function fileName(args: unknown): string | undefined {
  const a = record(args);
  const path = text(a.file_path) ?? text(a.path) ?? text(a.notebook_path);
  if (!path) return undefined;
  return path.split(/[\\/]/).filter(Boolean).at(-1);
}

/** The plain-words line for the agent's current tool call. */
export function doingNow(lastToolCall: ToolCallView | null): string {
  if (!lastToolCall) return "thinking…";
  const { toolName, args } = lastToolCall;

  if (WRITE_TOOLS.has(toolName)) {
    const name = fileName(args);
    return name ? `writing ${name}…` : "writing code…";
  }
  if (READ_TOOLS.has(toolName)) {
    const name = fileName(args);
    return name ? `reading ${name}…` : "reading the code…";
  }
  if (SEARCH_TOOLS.has(toolName)) return "looking through the code…";
  if (SHELL_TOOLS.has(toolName)) {
    const command = text(record(args).command) ?? "";
    return CHECK_COMMAND.test(command)
      ? "running the checks…"
      : "running a command…";
  }
  if (toolName === "skill" || toolName === "skill_read") {
    return "reading up on how to do this…";
  }
  if (toolName === "product-progress") return "noting progress…";

  if (toolName.startsWith("reactor-project-")) {
    const verb = toolName.slice("reactor-project-".length);
    if (verb === "check") return "running the checks…";
    if (verb === "start" || verb === "restart") return "starting the preview…";
    if (verb === "init") return "setting up your project…";
    if (verb === "build") return "putting it together…";
    if (verb.startsWith("publish")) return "getting it ready to go live…";
    return "working on your project…";
  }
  if (toolName.startsWith("spec-preview-")) return "updating the preview…";
  if (toolName.startsWith("spec-")) {
    if (toolName === "spec-generate") return "generating the code…";
    return "working on the design…";
  }
  if (toolName.startsWith("deploy-environment-")) {
    return "getting it ready to go live…";
  }
  return "working…";
}
