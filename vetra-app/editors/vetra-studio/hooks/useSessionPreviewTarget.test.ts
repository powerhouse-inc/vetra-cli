import { describe, expect, it } from "vitest";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { extractPreviewTarget } from "./useSessionPreviewTarget.js";

type Message = ChatSessionDocument["state"]["global"]["messages"][number];
type ContentPart = Message["content"][number];

function makeSession(messages: Message[]): ChatSessionDocument {
  /* The extractor only reads state.global.messages — the rest of the
   * document shape is irrelevant. Cast through unknown to satisfy the full
   * type. */
  return {
    state: { global: { messages } } as never,
  } as unknown as ChatSessionDocument;
}

function part(overrides: Partial<ContentPart>): ContentPart {
  return {
    id: "p",
    type: "TEXT",
    text: null,
    toolCallId: null,
    toolName: null,
    args: null,
    result: null,
    isError: null,
    mediaType: null,
    url: null,
    data: null,
    filename: null,
    error: null,
    ...overrides,
  };
}

function msg(role: Message["role"], content: ContentPart[]): Message {
  return {
    id: `m-${Math.random()}`,
    role,
    content,
    stepIndex: null,
    createdAt: "2026-05-25T12:00:00.000Z",
    usage: null,
  };
}

function showCall(
  toolCallId: string,
  args: Record<string, unknown>,
): ContentPart {
  return part({
    id: `call-${toolCallId}`,
    type: "TOOL_CALL",
    toolCallId,
    toolName: "spec-preview-show",
    args: JSON.stringify(args),
  });
}

function showResult(
  toolCallId: string,
  data: Record<string, unknown> | null,
  opts?: { isError?: boolean },
): ContentPart {
  return part({
    id: `res-${toolCallId}`,
    type: "TOOL_RESULT",
    toolCallId,
    toolName: "spec-preview-show",
    result: data === null ? null : JSON.stringify({ data }),
    isError: opts?.isError ?? false,
  });
}

describe("extractPreviewTarget", () => {
  it("returns undefined for an empty session", () => {
    expect(extractPreviewTarget(makeSession([]))).toBeUndefined();
  });

  it("returns undefined when no spec-preview-show has fired", () => {
    const session = makeSession([
      msg("USER", [part({ id: "1", type: "TEXT", text: "hi" })]),
      msg("ASSISTANT", [
        part({
          id: "2",
          type: "TOOL_CALL",
          toolCallId: "x",
          toolName: "spec-preview-create",
          args: JSON.stringify({ project: "p1" }),
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("extracts project + doc from the latest successful spec-preview-show", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        showCall("c1", { project: "workout-tracker", name: "Bench Day" }),
      ]),
      msg("TOOL", [
        showResult("c1", {
          projectPath: "/abs/workout-tracker",
          driveId: "preview-abcd1234",
          documentId: "doc-7",
          documentSlug: "bench-day",
          previewUrl:
            "http://localhost:3001/d/preview-abcd1234/bench-day?embed=1",
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      project: "workout-tracker",
      doc: "bench-day",
    });
  });

  it("falls back to documentId when documentSlug is null", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", { project: "p1" })]),
      msg("TOOL", [
        showResult("c1", {
          projectPath: "/abs/p1",
          driveId: "preview-x",
          documentId: "doc-only-id",
          documentSlug: null,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      project: "p1",
      doc: "doc-only-id",
    });
  });

  it("prefers the most recent result and skips errored ones", () => {
    const session = makeSession([
      // older successful call
      msg("ASSISTANT", [showCall("c1", { project: "old-project" })]),
      msg("TOOL", [
        showResult("c1", {
          projectPath: "/abs/old",
          driveId: "preview-old",
          documentSlug: "old-doc",
        }),
      ]),
      // newer errored call — should be ignored
      msg("ASSISTANT", [showCall("c2", { project: "errored" })]),
      msg("TOOL", [showResult("c2", null, { isError: true })]),
      // newest successful call — should win
      msg("ASSISTANT", [showCall("c3", { project: "newest" })]),
      msg("TOOL", [
        showResult("c3", {
          projectPath: "/abs/newest",
          driveId: "preview-newest",
          documentSlug: "newest-doc",
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toEqual({
      project: "newest",
      doc: "newest-doc",
    });
  });

  it("ignores results whose matching call can't be found", () => {
    /* Defensive: if the call message is somehow missing, drop the result
     * rather than emit an incomplete target. */
    const session = makeSession([
      msg("TOOL", [
        showResult("orphan", {
          projectPath: "/x",
          driveId: "y",
          documentSlug: "z",
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("ignores results whose call args omit `project`", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", { name: "no project field" })]),
      msg("TOOL", [
        showResult("c1", {
          projectPath: "/abs",
          driveId: "drv",
          documentSlug: "doc",
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("ignores results whose JSON is malformed", () => {
    const session = makeSession([
      msg("ASSISTANT", [showCall("c1", { project: "p" })]),
      msg("TOOL", [
        part({
          id: "broken",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-preview-show",
          result: "not valid json {",
          isError: false,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });

  it("ignores tool results from other tools (e.g. spec-preview-create)", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        part({
          id: "call",
          type: "TOOL_CALL",
          toolCallId: "c1",
          toolName: "spec-preview-create",
          args: JSON.stringify({ project: "p" }),
        }),
      ]),
      msg("TOOL", [
        part({
          id: "res",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-preview-create",
          result: JSON.stringify({
            data: { driveId: "x", document: { header: { id: "y" } } },
          }),
          isError: false,
        }),
      ]),
    ]);
    expect(extractPreviewTarget(session)).toBeUndefined();
  });
});
