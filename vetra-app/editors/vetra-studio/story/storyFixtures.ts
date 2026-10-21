/** Conversation fixtures for the story tests. */
import type {
  ContentPart,
  Message,
} from "@powerhousedao/clint-common/document-models/chat-session";
import { actions } from "document-models/studio-product";
import { readProduct } from "../shell/useStudioState.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import type { StoryChat } from "./storyModel.js";

/** `atSec(5, 30)` is 10:05:30 on 2026-10-20 (UTC). */
export function atSec(minute: number, second: number): string {
  return new Date(Date.UTC(2026, 9, 20, 10, minute, second)).toISOString();
}

function part(fields: Partial<ContentPart> & Pick<ContentPart, "id" | "type">) {
  return {
    args: null,
    attachment: null,
    error: null,
    filename: null,
    isError: null,
    mediaType: null,
    result: null,
    text: null,
    toolCallId: null,
    toolName: null,
    url: null,
    ...fields,
  } as ContentPart;
}

function message(
  fields: Partial<Message> & Pick<Message, "id" | "role" | "createdAt">,
): Message {
  return {
    content: [],
    failure: null,
    finishReason: null,
    finishedAt: null,
    pickedUpAt: null,
    stepIndex: null,
    usage: null,
    ...fields,
  };
}

export function user(
  id: string,
  text: string,
  createdAt: string,
  pickedUpAt: string | null = null,
): Message {
  return message({
    id,
    role: "USER",
    createdAt,
    pickedUpAt,
    content: [part({ id: `${id}-t`, type: "TEXT", text })],
  });
}

export function reply(
  id: string,
  text: string,
  createdAt: string,
  finishedAt: string | null = null,
): Message {
  return message({
    id,
    role: "ASSISTANT",
    createdAt,
    finishedAt,
    content: [part({ id: `${id}-t`, type: "TEXT", text })],
  });
}

export function toolCall(
  id: string,
  toolName: string,
  args: Record<string, unknown>,
  createdAt: string,
): Message {
  return message({
    id,
    role: "ASSISTANT",
    createdAt,
    content: [
      part({
        id: `${id}-c`,
        type: "TOOL_CALL",
        toolName,
        toolCallId: `${id}-call`,
        args: JSON.stringify(args),
      }),
    ],
  });
}

export function chat(...messages: Message[]): StoryChat {
  return { status: "ACTIVE", interruptRequested: false, messages };
}

/** A building product (change c1) with milestones at 10:03 and 10:06. */
export function buildingProduct() {
  return readProduct(
    productDoc(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
      actions.addMilestone({
        changeId: "c1",
        id: "m1",
        text: "Planned 1 app · 7 features",
        at: at(3),
      }),
      actions.completeStep({ changeId: "c1", kind: "PLAN", at: at(3) }),
      actions.startStep({
        changeId: "c1",
        kind: "DATA",
        at: at(4),
        label: "Designing the task data",
      }),
      actions.addMilestone({
        changeId: "c1",
        id: "m2",
        text: "retried once on a backup model",
        at: at(6),
        recovered: true,
      }),
    ).state.global,
  );
}
