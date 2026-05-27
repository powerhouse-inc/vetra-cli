import type { AgentEvent, ToolResultEvent, ToolUseEvent } from "./events.js";

/**
 * Parse a Vetra Agent markdown session log into a sequence of typed events.
 *
 * The grammar is line-oriented and predictable:
 *
 *   ## User Message
 *   **Time**: 2026-...
 *   ````md
 *   <body>
 *   ````
 *
 *   ## Tool Use: <tool-name>
 *   **Time**: 2026-...
 *   **Call ID**: toolu_...
 *   **Input**:
 *   ````json
 *   { ... }
 *   ````
 *
 *   ## Tool Result: <tool-name>
 *   **Time**: 2026-...
 *   **Call ID**: toolu_...
 *   **Output**:
 *   ````json
 *   { ... }
 *   ````
 *   -- OR --
 *   **Error**: { "message": "...", ... }
 *
 * Anything between events that doesn't match these headers is ignored.
 */
export function parseAgentLog(source: string): AgentEvent[] {
  const lines = source.split("\n");
  const events: AgentEvent[] = [];
  let index = 0;
  let i = 0;
  while (i < lines.length) {
    const headerMatch = /^## (User Message|Assistant Message|Tool Use:\s*(\S+)|Tool Result:\s*(\S+))\s*$/.exec(
      lines[i],
    );
    if (!headerMatch) {
      i++;
      continue;
    }
    const headerLine = i + 1; // 1-indexed for human-readable references
    const [, kindRaw, useTool, resultTool] = headerMatch;
    index++;

    // Scan ahead to the next `## ` header to bound this event's body.
    let end = i + 1;
    while (end < lines.length && !/^## /.test(lines[end])) end++;
    const body = lines.slice(i + 1, end);

    const time = matchInline(body, /^\*\*Time\*\*:\s*(.+)$/)?.[1];
    const callId = matchInline(body, /^\*\*Call ID\*\*:\s*(.+)$/)?.[1];

    if (kindRaw === "User Message" || kindRaw === "Assistant Message") {
      const content = extractFencedBlock(body) ?? "";
      events.push({
        kind: kindRaw === "User Message" ? "user_message" : "assistant_message",
        index,
        line: headerLine,
        time,
        content,
      });
    } else if (useTool) {
      const input = parseJsonBlockOrRaw(body, /^\*\*Input\*\*:\s*$/);
      events.push({
        kind: "tool_use",
        index,
        line: headerLine,
        time,
        tool: useTool,
        callId,
        input,
      } satisfies ToolUseEvent);
    } else if (resultTool) {
      const errorLine = body.findIndex((l) => /^\*\*Error\*\*:/.test(l));
      if (errorLine !== -1) {
        const inlineErr = body[errorLine].replace(/^\*\*Error\*\*:\s*/, "");
        const error = safeJsonParse(inlineErr) ?? { message: inlineErr };
        events.push({
          kind: "tool_result",
          index,
          line: headerLine,
          time,
          tool: resultTool,
          callId,
          output: undefined,
          error: error as ToolResultEvent["error"],
        });
      } else {
        const output = parseJsonBlockOrRaw(body, /^\*\*Output\*\*:\s*$/);
        events.push({
          kind: "tool_result",
          index,
          line: headerLine,
          time,
          tool: resultTool,
          callId,
          output,
        });
      }
    }
    i = end;
  }
  return events;
}

function matchInline(body: string[], re: RegExp): RegExpExecArray | null {
  for (const line of body) {
    const m = re.exec(line);
    if (m) return m;
  }
  return null;
}

/** Find the first fenced code block (```` ```... ```` ````) in body. */
function extractFencedBlock(body: string[]): string | null {
  const start = body.findIndex((l) => /^````/.test(l));
  if (start === -1) return null;
  const end = body.findIndex((l, idx) => idx > start && /^````\s*$/.test(l));
  if (end === -1) return null;
  return body.slice(start + 1, end).join("\n");
}

/** Locate a `**Label**:` line in body, then parse the following fenced
 *  block as JSON. Returns the parsed object, or the raw string on parse
 *  failure, or undefined if no block follows. */
function parseJsonBlockOrRaw(body: string[], labelRe: RegExp): unknown {
  const labelIdx = body.findIndex((l) => labelRe.test(l));
  if (labelIdx === -1) return undefined;
  const fenceStart = body.findIndex(
    (l, idx) => idx > labelIdx && /^````/.test(l),
  );
  if (fenceStart === -1) return undefined;
  const fenceEnd = body.findIndex(
    (l, idx) => idx > fenceStart && /^````\s*$/.test(l),
  );
  if (fenceEnd === -1) return undefined;
  const raw = body.slice(fenceStart + 1, fenceEnd).join("\n");
  return safeJsonParse(raw) ?? raw;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
