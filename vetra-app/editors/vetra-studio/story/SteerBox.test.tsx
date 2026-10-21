// @vitest-environment happy-dom
import type { Message } from "@powerhousedao/clint-common/document-models/chat-session";
import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render, typeInto } from "../test-utils/render.js";
import { PRODUCT_ID, SESSION_ID, at } from "../test-utils/studioFixtures.js";
import { SteerBox, STEER_PLACEHOLDER } from "./SteerBox.js";
import { atSec, user } from "./storyFixtures.js";

type Dispatched = {
  action: { type: string; input: Record<string, unknown> };
  id: string;
};

const hoisted = vi.hoisted(() => ({ dispatched: [] as Dispatched[] }));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => undefined,
  dispatchActions: (action: Dispatched["action"], id: string) => {
    hoisted.dispatched.push({ action, id });
    return Promise.resolve();
  },
}));

beforeEach(() => {
  hoisted.dispatched = [];
});

/** Lets a test change the conversation the box sees. */
const setMessages: { current: (m: Message[]) => void } = {
  current: () => {},
};

function Harness({ paused = false }: { paused?: boolean }) {
  const [messages, set] = useState<Message[]>([]);
  setMessages.current = set;
  return (
    <SteerBox
      sessionId={SESSION_ID}
      productId={PRODUCT_ID}
      changeId="c1"
      paused={paused}
      messages={messages}
      now={new Date(atSec(5, 10))}
    />
  );
}

async function submit(container: HTMLElement, text: string) {
  typeInto(container.querySelector('input[aria-label="Steer it"]'), text);
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe("SteerBox", () => {
  it("steer message shows sent then seen by the agent", async () => {
    const container = render(<Harness />);
    const input = container.querySelector("input");
    expect(input?.getAttribute("placeholder")).toBe(STEER_PLACEHOLDER);
    expect(input?.disabled).toBe(false);

    await submit(container, "add a Ready column");
    expect(hoisted.dispatched).toHaveLength(1);
    const [{ action, id }] = hoisted.dispatched;
    expect(id).toBe(SESSION_ID);
    expect(action.type).toBe("ADD_USER_MESSAGE");
    expect(action.input.content).toMatchObject([
      { type: "TEXT", text: "add a Ready column" },
    ]);
    expect(input?.value).toBe("");
    expect(container.querySelector("[data-delivery]")?.textContent).toBe(
      "Sent",
    );

    const sentId = action.input.id as string;
    act(() => setMessages.current([user(sentId, "add a Ready column", at(5))]));
    expect(container.querySelector("[data-delivery]")?.textContent).toBe(
      "Sent",
    );

    act(() =>
      setMessages.current([
        user(sentId, "add a Ready column", at(5), atSec(5, 4)),
      ]),
    );
    expect(container.querySelector("[data-delivery]")?.textContent).toBe(
      "Seen by the agent",
    );
    expectNoForbiddenWords(container);
  });

  it("Pause dispatches PAUSE_CHANGE and shows Continue", () => {
    const container = render(<Harness />);
    click(button(container, "Pause"));
    expect(hoisted.dispatched).toHaveLength(1);
    const [{ action, id }] = hoisted.dispatched;
    expect(id).toBe(PRODUCT_ID);
    expect(action.type).toBe("PAUSE_CHANGE");
    expect(action.input).toMatchObject({ changeId: "c1" });
    expect(button(container, "Continue")).toBeDefined();
    expect(button(container, "Pause")).toBeUndefined();

    click(button(container, "Continue"));
    expect(hoisted.dispatched[1].action.type).toBe("RESUME_CHANGE");
    expect(button(container, "Pause")).toBeDefined();
    expectNoForbiddenWords(container);
  });

  it("a paused change shows Continue", () => {
    const container = render(<Harness paused />);
    expect(button(container, "Continue")).toBeDefined();
    // Steering stays possible while paused.
    expect(container.querySelector("input")?.disabled).toBe(false);
  });
});
