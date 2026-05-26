/**
 * Typed events extracted from a Vetra Agent session log.
 *
 * The log format is a markdown document with one `## <Kind>` header per
 * event (User Message, Assistant Message, Tool Use, Tool Result), followed
 * by a `**Time**: <iso>` line, optional `**Call ID**: <id>`, and either an
 * inline `**Error**: <json>` line or a fenced code block of content.
 *
 * `ToolUseEvent.input` and `ToolResultEvent.output` are the parsed JSON
 * payloads when the content is JSON; otherwise the raw string.
 */

export interface BaseEvent {
  kind: AgentEvent["kind"];
  /** Position in the conversation (1-indexed). Useful for ordering checks. */
  index: number;
  /** Line in the source log where this event's `##` header sits. */
  line: number;
  time?: string;
}

export interface UserMessageEvent extends BaseEvent {
  kind: "user_message";
  content: string;
}

export interface AssistantMessageEvent extends BaseEvent {
  kind: "assistant_message";
  content: string;
}

export interface ToolUseEvent extends BaseEvent {
  kind: "tool_use";
  tool: string;
  callId?: string;
  input: unknown;
}

export interface ToolResultEvent extends BaseEvent {
  kind: "tool_result";
  tool: string;
  callId?: string;
  /** Tool result payload (parsed JSON if it parsed, otherwise raw string). */
  output: unknown;
  /** Present when the tool errored. The framework writes errors as a single
   *  `**Error**: <json>` line instead of a fenced code block. */
  error?: { message: string; details?: unknown };
}

export type AgentEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolUseEvent
  | ToolResultEvent;
