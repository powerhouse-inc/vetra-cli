import { describe, expect, it } from "vitest";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { extractDeployTarget } from "./useSessionDeployTarget.js";

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
    createdAt: "2026-05-25T12:00:00.000Z",
    usage: null,
  };
}

function toolCall(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
): ContentPart {
  return part({
    id: `call-${toolCallId}`,
    type: "TOOL_CALL",
    toolCallId,
    toolName,
    args: JSON.stringify(args),
  });
}

const publish = (id: string, args: Record<string, unknown>) =>
  toolCall("reactor-project-publish", id, args);
const envUpdate = (id: string, args: Record<string, unknown>) =>
  toolCall("deploy-environment-update", id, args);

describe("extractDeployTarget", () => {
  it("returns undefined for an empty session", () => {
    expect(extractDeployTarget(makeSession([]))).toBeUndefined();
  });

  it("returns undefined when no deploy command has fired", () => {
    const session = makeSession([
      msg("ASSISTANT", [toolCall("reactor-project-build", "b1", {})]),
      msg("ASSISTANT", [toolCall("reactor-project-publish-status", "s1", {})]),
    ]);
    expect(extractDeployTarget(session)).toBeUndefined();
  });

  it("extracts the project from reactor-project-publish --name", () => {
    const session = makeSession([
      msg("ASSISTANT", [publish("c1", { name: "todo-app", version: "1.2.0" })]),
    ]);
    expect(extractDeployTarget(session)).toEqual({
      project: "todo-app",
      callId: "c1",
    });
  });

  it("skips a publish with no name (cwd project can't be pinpointed)", () => {
    const session = makeSession([
      msg("ASSISTANT", [publish("c1", { version: "1.0.0" })]),
    ]);
    expect(extractDeployTarget(session)).toBeUndefined();
  });

  it("extracts a package from deploy-environment-update --addPackage (array)", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        envUpdate("c1", { name: "prod", addPackage: ["@acme/todo@1.2.0"] }),
      ]),
    ]);
    expect(extractDeployTarget(session)).toEqual({
      packageName: "@acme/todo",
      callId: "c1",
    });
  });

  it("accepts the comma-string form of addPackage and strips the version", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        envUpdate("c1", { name: "prod", addPackage: "todo@3.0.1" }),
      ]),
    ]);
    expect(extractDeployTarget(session)).toEqual({
      packageName: "todo",
      callId: "c1",
    });
  });

  it("keeps a scoped package with no version intact", () => {
    const session = makeSession([
      msg("ASSISTANT", [envUpdate("c1", { addPackage: ["@acme/todo"] })]),
    ]);
    expect(extractDeployTarget(session)).toEqual({
      packageName: "@acme/todo",
      callId: "c1",
    });
  });

  it("ignores deploy-environment-update calls with no addPackage", () => {
    const session = makeSession([
      msg("ASSISTANT", [envUpdate("c1", { name: "prod", label: "Renamed" })]),
      msg("ASSISTANT", [
        envUpdate("c2", { name: "prod", transition: "CHANGES_APPROVED" }),
      ]),
    ]);
    expect(extractDeployTarget(session)).toBeUndefined();
  });

  it("returns the newest matching deploy call, skipping intervening non-deploy ones", () => {
    const session = makeSession([
      msg("ASSISTANT", [publish("c1", { name: "todo-app" })]),
      msg("ASSISTANT", [
        envUpdate("c2", { name: "prod", addPackage: ["@acme/todo@2.0.0"] }),
      ]),
      // the go-live + wait steps that follow carry no project/package
      msg("ASSISTANT", [
        envUpdate("c3", { name: "prod", transition: "CHANGES_APPROVED" }),
      ]),
      msg("ASSISTANT", [
        toolCall("deploy-environment-wait", "c4", { name: "prod" }),
      ]),
    ]);
    expect(extractDeployTarget(session)).toEqual({
      packageName: "@acme/todo",
      callId: "c2",
    });
  });

  it("skips a deploy call whose args are malformed JSON", () => {
    const session = makeSession([
      msg("ASSISTANT", [
        part({
          id: "broken",
          type: "TOOL_CALL",
          toolCallId: "c1",
          toolName: "reactor-project-publish",
          args: "not valid json {",
        }),
      ]),
    ]);
    expect(extractDeployTarget(session)).toBeUndefined();
  });
});
