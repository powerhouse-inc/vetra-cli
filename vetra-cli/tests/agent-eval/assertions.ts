/**
 * Anti-foot-gun assertions over a parsed agent session log.
 *
 * Each assertion returns the same shape: `{ passed, violations }`. A test
 * caller can either assert `passed` or collect specific violations for a
 * richer message. Assertions operate on the typed `AgentEvent[]` produced
 * by `log-parser.ts`.
 */
import type {
  AgentEvent,
  ToolResultEvent,
  ToolUseEvent,
} from "./events.js";

export interface Violation {
  /** Conversation index (1-based) where the violation occurred. */
  index: number;
  /** Line in the source log. */
  line: number;
  message: string;
}

export interface AssertionResult {
  passed: boolean;
  violations: Violation[];
}

const pass = (): AssertionResult => ({ passed: true, violations: [] });

function fail(violations: Violation[]): AssertionResult {
  return { passed: violations.length === 0, violations };
}

const WRITE_TOOLS = new Set([
  "mastra_workspace_edit_file",
  "mastra_workspace_write_file",
  "mastra_workspace_delete",
  "mastra_workspace_mkdir",
]);

const GEN_SEGMENT = /\/gen\//;

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

/* ------------------------------------------------------------------ */
/* 1. No write tool ever touches a path under /gen/                    */
/* ------------------------------------------------------------------ */
export function neverEditedGenFiles(events: AgentEvent[]): AssertionResult {
  const violations: Violation[] = [];
  for (const ev of events) {
    if (ev.kind !== "tool_use" || !WRITE_TOOLS.has(ev.tool)) continue;
    const path = readPath(ev.input);
    if (path && GEN_SEGMENT.test(path)) {
      violations.push({
        index: ev.index,
        line: ev.line,
        message: `${ev.tool} on "${path}" — generated files are off-limits`,
      });
    }
  }
  return fail(violations);
}

/* ------------------------------------------------------------------ */
/* 2. RELEASE_NEW_VERSION only after the spec has at least one module  */
/* ------------------------------------------------------------------ */
export function noReleaseBeforeModules(events: AgentEvent[]): AssertionResult {
  const violations: Violation[] = [];
  /** spec name → has-an-ADD_MODULE-applied flag. Resets are uncommon, so
   *  once true the spec is considered "has a module" for the rest of the
   *  session — this matches the foot-gun we're guarding against. */
  const seenModule = new Map<string, boolean>();
  for (const ev of events) {
    if (ev.kind !== "tool_use" || ev.tool !== "spec-update") continue;
    const input = ev.input as Record<string, unknown> | null;
    const specName = String(input?.name ?? "<unknown>");
    const actions = readActions(input);
    for (const a of actions) {
      if (a.type === "ADD_MODULE") {
        seenModule.set(specName, true);
      } else if (a.type === "RELEASE_NEW_VERSION") {
        if (!seenModule.get(specName)) {
          violations.push({
            index: ev.index,
            line: ev.line,
            message: `RELEASE_NEW_VERSION on "${specName}" before any ADD_MODULE — seals an empty spec`,
          });
        }
      }
    }
  }
  return fail(violations);
}

/* ------------------------------------------------------------------ */
/* 3. Every operation name is SCREAMING_SNAKE_CASE                     */
/* ------------------------------------------------------------------ */
export function allOperationNamesCanonical(
  events: AgentEvent[],
): AssertionResult {
  const violations: Violation[] = [];
  for (const ev of events) {
    if (ev.kind !== "tool_use" || ev.tool !== "spec-update") continue;
    for (const a of readActions(ev.input as Record<string, unknown> | null)) {
      if (a.type !== "ADD_OPERATION" && a.type !== "SET_OPERATION_NAME")
        continue;
      const name = (a.input as Record<string, unknown> | undefined)?.name;
      if (typeof name === "string" && name.length > 0 && !SCREAMING_SNAKE.test(name)) {
        violations.push({
          index: ev.index,
          line: ev.line,
          message: `${a.type} with name="${name}" — operation names must match ${SCREAMING_SNAKE.source}`,
        });
      }
    }
  }
  return fail(violations);
}

/* ------------------------------------------------------------------ */
/* 4. After spec-generate reports diagnostics, the next non-readonly   */
/*    action must address them (spec-update / mastra_workspace_delete) */
/*    — not skip ahead to spec-preview-*.                              */
/* ------------------------------------------------------------------ */
const REMEDIATION_TOOLS = new Set([
  "spec-update",
  "spec-delete",
  "mastra_workspace_delete",
  "reactor-project-restart",
  "spec-generate",
  "reactor-project-check",
]);
const PREVIEW_TOOLS = new Set([
  "spec-preview-create",
  "spec-preview-update",
  "spec-preview-show",
]);

export function respondsToDiagnostics(events: AgentEvent[]): AssertionResult {
  const violations: Violation[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (
      ev.kind !== "tool_result" ||
      ev.tool !== "spec-generate" ||
      ev.error ||
      !hasDiagnostics(ev)
    ) {
      continue;
    }
    // Find the next mutating/preview tool call.
    const next = events.slice(i + 1).find(
      (e): e is ToolUseEvent =>
        e.kind === "tool_use" &&
        (REMEDIATION_TOOLS.has(e.tool) || PREVIEW_TOOLS.has(e.tool)),
    );
    if (!next) continue; // session ended; let the final-state check catch it
    if (PREVIEW_TOOLS.has(next.tool)) {
      violations.push({
        index: next.index,
        line: next.line,
        message: `Advanced to ${next.tool} while spec-generate at index ${ev.index} reported diagnostics`,
      });
    }
  }
  return fail(violations);
}

/* ------------------------------------------------------------------ */
/* 5. Final state: most recent spec-generate / reactor-project-check   */
/*    result has empty diagnostics.                                    */
/* ------------------------------------------------------------------ */
export function finalCheckClean(events: AgentEvent[]): AssertionResult {
  // Walk from the end. Find the last successful spec-generate or
  // reactor-project-check; require its diagnostics array to be empty.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (
      ev.kind !== "tool_result" ||
      ev.error ||
      (ev.tool !== "spec-generate" && ev.tool !== "reactor-project-check")
    ) {
      continue;
    }
    const diags = readDiagnostics(ev);
    if (diags.length === 0) return pass();
    return fail([
      {
        index: ev.index,
        line: ev.line,
        message: `Final ${ev.tool} reported ${diags.length} diagnostic(s)`,
      },
    ]);
  }
  // No check ever ran.
  return fail([
    {
      index: events.length,
      line: 0,
      message: "Session ended without any successful spec-generate or reactor-project-check",
    },
  ]);
}

/* ------------------------------------------------------------------ */
/* 6. Bounded tool calls                                              */
/* ------------------------------------------------------------------ */
export function boundedToolCalls(
  events: AgentEvent[],
  maxCalls: number,
): AssertionResult {
  const calls = events.filter((e) => e.kind === "tool_use").length;
  if (calls <= maxCalls) return pass();
  return fail([
    {
      index: events.length,
      line: 0,
      message: `${calls} tool calls exceeded the budget of ${maxCalls}`,
    },
  ]);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function readPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const p = (input as Record<string, unknown>).path;
  return typeof p === "string" ? p : undefined;
}

interface ActionInput {
  type?: string;
  input?: unknown;
}

function readActions(input: Record<string, unknown> | null | undefined): ActionInput[] {
  if (!input) return [];
  const a = input.actions;
  if (!Array.isArray(a)) return [];
  return a as ActionInput[];
}

function hasDiagnostics(ev: ToolResultEvent): boolean {
  return readDiagnostics(ev).length > 0;
}

function readDiagnostics(ev: ToolResultEvent): string[] {
  const text = (ev.output as Record<string, unknown> | undefined)?.text;
  if (typeof text !== "string") return [];
  // spec-generate / reactor-project-check render each diagnostic as a line
  // `  ✗ [source] file:line:col code — message` (✗ = error, ! = warning).
  // Skipped/generated lines (`✗ <type> — …`, `✓ …`) lack the `[source]`
  // bracket, so the bracket anchor keeps them out of the count.
  return text.split("\n").filter((l) => /^\s*[✗!]\s+\[/.test(l));
}
