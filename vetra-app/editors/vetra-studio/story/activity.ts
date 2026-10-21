/**
 * The agent's steps grouped by what they were for (spec §5.4, the Activity
 * layer): reading, designing, writing code, checking, previewing, going live.
 * One short line per milestone instead of dozens of tool calls.
 *
 * Pure: reads the chat messages and the recorded check runs, changes nothing.
 */
import type { Message } from "@powerhousedao/clint-common/document-models/chat-session";
import type { CheckRun } from "document-models/studio-product";
import { parseToolValue } from "../tool-renderers/shared/util.js";
import {
  CHECK_COMMAND,
  READ_TOOLS,
  SEARCH_TOOLS,
  SHELL_TOOLS,
  WRITE_TOOLS,
} from "./doingNow.js";

export type Intent =
  "reading" | "specs" | "code" | "checks" | "preview" | "publishing" | "other";

/** Read-only workspace calls the shared sets don't list. */
const EXTRA_READ_TOOLS = new Set(["mastra_workspace_file_stat"]);

const READING_PROJECT_TOOLS = new Set([
  "reactor-project-ls",
  "reactor-project-ps",
  "reactor-project-logs",
  "attachment-stat",
  "attachment-get",
]);

function record(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

/** What a tool call was for. */
export function toolIntent(toolName: string, args: unknown): Intent {
  if (
    READ_TOOLS.has(toolName) ||
    SEARCH_TOOLS.has(toolName) ||
    EXTRA_READ_TOOLS.has(toolName) ||
    toolName.startsWith("skill") ||
    READING_PROJECT_TOOLS.has(toolName)
  ) {
    return "reading";
  }
  if (toolName.startsWith("spec-preview-")) return "preview";
  if (toolName === "spec-generate") return "code";
  if (toolName.startsWith("spec-")) return "specs";
  if (
    WRITE_TOOLS.has(toolName) ||
    toolName === "reactor-project-init" ||
    toolName === "reactor-project-build" ||
    toolName.startsWith("agent-agent")
  ) {
    return "code";
  }
  if (toolName === "reactor-project-check") return "checks";
  if (SHELL_TOOLS.has(toolName)) {
    const command = record(args).command;
    return typeof command === "string" && CHECK_COMMAND.test(command)
      ? "checks"
      : "other";
  }
  if (
    toolName === "reactor-project-start" ||
    toolName === "reactor-project-restart" ||
    toolName === "reactor-project-stop"
  ) {
    return "preview";
  }
  if (
    toolName.startsWith("reactor-project-publish") ||
    toolName.startsWith("deploy-") ||
    toolName.startsWith("github-")
  ) {
    return "publishing";
  }
  return "other";
}

type Call = { toolName: string; args: unknown };

function callsOf(messages: readonly Message[]): Call[] {
  const calls: Call[] = [];
  for (const message of messages) {
    if (message.role !== "ASSISTANT") continue;
    for (const part of message.content) {
      if (part.type !== "TOOL_CALL") continue;
      calls.push({
        toolName: part.toolName || "unknown",
        args: parseToolValue(part.args),
      });
    }
  }
  return calls;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function filePath(args: unknown): string | undefined {
  const a = record(args);
  return str(a.file_path) ?? str(a.path) ?? str(a.notebook_path);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function failed(run: CheckRun): boolean {
  return run.results.some((result) => !result.passed);
}

/** `open`: the latest run when it fails; `recovered`: failed earlier, passes now. */
export function foldedFailures(checkRuns: readonly CheckRun[]): {
  recovered: boolean;
  open: CheckRun | null;
} {
  const latest = checkRuns.at(-1);
  if (!latest) return { recovered: false, open: null };
  if (failed(latest)) return { recovered: false, open: latest };
  return { recovered: checkRuns.slice(0, -1).some(failed), open: null };
}

function checksPhrase(checkRuns: readonly CheckRun[]): string | null {
  if (checkRuns.length === 0) return null;
  if (foldedFailures(checkRuns).open) return "checks failing";
  const tries = checkRuns.findIndex((run) => !failed(run)) + 1;
  return tries > 1 ? `checks passed after ${tries} tries` : "checks passed";
}

/** One line telling what the agent did, in the fixed order of the build. */
export function activitySummary(
  messages: readonly Message[],
  checkRuns: readonly CheckRun[],
): string {
  const calls = callsOf(messages);
  const seen = new Set<Intent>();
  const specNames = new Set<string>();
  const files = new Set<string>();
  let generated = false;
  for (const { toolName, args } of calls) {
    seen.add(toolIntent(toolName, args));
    if (toolName === "spec-generate") generated = true;
    if (toolName === "spec-create" || toolName === "spec-update") {
      const name = str(record(args).name);
      if (name) specNames.add(name);
    }
    if (WRITE_TOOLS.has(toolName)) {
      const path = filePath(args);
      if (path) files.add(path);
    }
  }

  const parts: string[] = [];
  if (seen.has("reading")) parts.push("Read the project");
  if (seen.has("specs")) {
    parts.push(
      specNames.size > 0
        ? `Wrote ${plural(specNames.size, "spec", "specs")}`
        : "Worked on the design",
    );
  }
  if (seen.has("code")) {
    if (generated) parts.push("generated code");
    else if (files.size > 0) {
      parts.push(`wrote ${plural(files.size, "file", "files")}`);
    } else parts.push("worked on the code");
  }
  const checks = checksPhrase(checkRuns);
  if (checks) parts.push(checks);
  if (seen.has("preview")) parts.push("updated the preview");
  if (seen.has("publishing")) parts.push("got it ready to go live");

  if (parts.length === 0) return "";
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
