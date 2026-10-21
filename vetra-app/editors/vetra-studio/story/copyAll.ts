/** Plain-text dump of the whole story for the Raw layer's "Copy all". */
import type { ContentPart } from "@powerhousedao/clint-common/document-models/chat-session";
import type { StoryLine } from "./storyModel.js";

type Messages = Extract<StoryLine, { kind: "idea" }>["detail"];

function resultText(part: ContentPart | undefined): string {
  if (!part) return "(no result yet)";
  return part.result ?? part.error ?? part.text ?? "";
}

function detailText(
  messages: Messages,
  results: ReadonlyMap<string, ContentPart>,
): string[] {
  const out: string[] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "TOOL_CALL") {
        out.push(
          `  tool: ${part.toolName ?? "unknown"}`,
          `  args: ${part.args ?? ""}`,
          `  result: ${resultText(part.toolCallId ? results.get(part.toolCallId) : undefined)}`,
        );
      } else if (part.type === "TEXT" && part.text) {
        out.push(`  ${message.role.toLowerCase()}: ${part.text}`);
      } else if (part.type === "ERROR" && (part.error || part.text)) {
        out.push(`  error: ${part.error ?? part.text}`);
      }
    }
  }
  return out;
}

function headline(line: StoryLine): string {
  switch (line.kind) {
    case "idea":
    case "reply":
    case "steer":
    case "waiting":
    case "checks":
      return line.text;
    case "milestone":
      return `${line.mark} ${line.text}`;
    case "stuck":
      return `Stuck: ${line.reason}`;
    case "attention":
      return `! ${line.text}`;
    case "paused":
      return "Paused";
  }
}

export function copyAllText(
  lines: StoryLine[],
  results: ReadonlyMap<string, ContentPart>,
): string {
  return lines
    .flatMap((line) => [
      headline(line),
      ...(line.kind === "idea" || line.kind === "milestone"
        ? detailText(line.detail, results)
        : []),
    ])
    .join("\n");
}
