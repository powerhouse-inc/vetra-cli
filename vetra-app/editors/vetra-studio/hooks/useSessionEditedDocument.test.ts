import { describe, expect, it } from "vitest";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { extractEditedDocument } from "./useSessionEditedDocument.js";

type Message = ChatSessionDocument["state"]["global"]["messages"][number];
type ContentPart = Message["content"][number];

function makeSession(messages: Message[]): ChatSessionDocument {
  /* The extractor only reads state.global.messages — the rest of the document
   * shape is irrelevant. Cast through unknown to satisfy the full type. */
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
    attachment: null,
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
    createdAt: "2026-06-25T12:00:00.000Z",
    usage: null,
  };
}

function editResult(
  toolName: "spec-create" | "spec-update",
  toolCallId: string,
  data: Record<string, unknown> | null,
  opts?: { isError?: boolean },
): ContentPart {
  return part({
    id: `res-${toolCallId}`,
    type: "TOOL_RESULT",
    toolCallId,
    toolName,
    result: data === null ? null : JSON.stringify({ data }),
    isError: opts?.isError ?? false,
  });
}

const FEATURE = {
  documentId: "doc-1",
  documentType: "powerhouse/feature",
  name: "My Feature",
};

describe("extractEditedDocument", () => {
  it("returns undefined for an empty session", () => {
    expect(extractEditedDocument(makeSession([]))).toBeUndefined();
  });

  it("extracts the edited document from a spec-create result", () => {
    const session = makeSession([
      msg("TOOL", [editResult("spec-create", "c1", FEATURE)]),
    ]);
    expect(extractEditedDocument(session)).toEqual({
      id: "doc-1",
      documentType: "powerhouse/feature",
      name: "My Feature",
      callId: "c1",
    });
  });

  it("extracts from a spec-update result", () => {
    const session = makeSession([
      msg("TOOL", [
        editResult("spec-update", "c2", {
          documentId: "doc-9",
          documentType: "powerhouse/document-model",
          name: "Task Model",
        }),
      ]),
    ]);
    expect(extractEditedDocument(session)).toEqual({
      id: "doc-9",
      documentType: "powerhouse/document-model",
      name: "Task Model",
      callId: "c2",
    });
  });

  it("prefers the most recent edit (later update shadows earlier create)", () => {
    const session = makeSession([
      msg("TOOL", [editResult("spec-create", "c1", FEATURE)]),
      msg("TOOL", [
        editResult("spec-update", "c2", {
          documentId: "doc-2",
          documentType: "powerhouse/problem-sheet",
          name: "Problem",
        }),
      ]),
    ]);
    expect(extractEditedDocument(session)?.callId).toBe("c2");
    expect(extractEditedDocument(session)?.id).toBe("doc-2");
  });

  it("skips errored results", () => {
    const session = makeSession([
      msg("TOOL", [editResult("spec-create", "c1", FEATURE)]),
      msg("TOOL", [editResult("spec-update", "c2", null, { isError: true })]),
    ]);
    expect(extractEditedDocument(session)?.callId).toBe("c1");
  });

  it("skips results missing data.documentId (e.g. dryRun create)", () => {
    const session = makeSession([
      msg("TOOL", [editResult("spec-create", "c1", FEATURE)]),
      // a later create without a persisted id — falls back to c1
      msg("TOOL", [
        editResult("spec-create", "c2", {
          documentType: "powerhouse/feature",
          name: "In-memory only",
        }),
      ]),
    ]);
    expect(extractEditedDocument(session)?.callId).toBe("c1");
  });

  it("ignores non-edit tool results", () => {
    const session = makeSession([
      msg("TOOL", [
        part({
          id: "show",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-preview-show",
          result: JSON.stringify({ data: { documentId: "doc-x" } }),
          isError: false,
        }),
      ]),
    ]);
    expect(extractEditedDocument(session)).toBeUndefined();
  });

  it("ignores results whose JSON is malformed", () => {
    const session = makeSession([
      msg("TOOL", [
        part({
          id: "broken",
          type: "TOOL_RESULT",
          toolCallId: "c1",
          toolName: "spec-create",
          result: "not valid json {",
          isError: false,
        }),
      ]),
    ]);
    expect(extractEditedDocument(session)).toBeUndefined();
  });
});
