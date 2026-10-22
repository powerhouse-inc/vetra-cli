// @vitest-environment happy-dom
import type { Message } from "@powerhousedao/clint-common/document-models/chat-session";
import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render, typeInto } from "../test-utils/render.js";
import { PRODUCT_ID, SESSION_ID, at } from "../test-utils/studioFixtures.js";
import {
  CONTINUE_NOT_SENT_TEXT,
  SteerBox,
  STEER_PLACEHOLDER,
} from "./SteerBox.js";
import { CONTINUE_ID_PREFIX } from "./storyModel.js";
import { StoryPane } from "./StoryPane.js";
import { atSec, buildingProduct, chat, user } from "./storyFixtures.js";

type Dispatched = {
  action: { type: string; input: Record<string, unknown> };
  id: string;
};

const hoisted = vi.hoisted(() => ({
  dispatched: [] as Dispatched[],
  /** How many ADD_USER_MESSAGE dispatches fail before one succeeds. */
  failMessages: 0,
  toasts: [] as string[],
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => (text: string) => hoisted.toasts.push(text),
  dispatchActions: (action: Dispatched["action"], id: string) => {
    hoisted.dispatched.push({ action, id });
    if (action.type === "ADD_USER_MESSAGE" && hoisted.failMessages > 0) {
      hoisted.failMessages--;
      return Promise.reject(new Error("offline"));
    }
    return Promise.resolve();
  },
}));

beforeEach(() => {
  hoisted.dispatched = [];
  hoisted.failMessages = 0;
  hoisted.toasts = [];
});

/** Lets a test change the conversation and the clock the box sees. */
const set: {
  messages: (m: Message[]) => void;
  now: (d: Date) => void;
} = { messages: () => {}, now: () => {} };

function Harness({ paused = false }: { paused?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [now, setNow] = useState(() => new Date(atSec(5, 10)));
  set.messages = setMessages;
  set.now = setNow;
  return (
    <SteerBox
      sessionId={SESSION_ID}
      productId={PRODUCT_ID}
      changeId="c1"
      paused={paused}
      messages={messages}
      now={now}
    />
  );
}

/** The steer box inside the story, as the shell shows it. */
function StoryHarness() {
  const [messages, setMessages] = useState<Message[]>([
    user("u0", "a task board for my team", at(1), at(1)),
  ]);
  set.messages = setMessages;
  const product = buildingProduct();
  const change = product.changes[0];
  return (
    <StoryPane
      product={product}
      change={change}
      chat={chat(...messages)}
      sessionId={SESSION_ID}
      productId={PRODUCT_ID}
      now={new Date(atSec(7, 10))}
    />
  );
}

function deliveries(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-delivery]")).map(
    (el) => el.textContent,
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
  it("a viewer sees the watch-and-comment notice instead of the box (P6)", () => {
    const c = render(
      <SteerBox
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        changeId="c1"
        paused={false}
        messages={[]}
        now={new Date(atSec(5, 10))}
        readOnly
      />,
    );
    expect(c.querySelector("input")).toBeNull();
    expect(c.textContent).toContain(
      "You can watch and comment. Ask an Owner if you want to make changes.",
    );
    expectNoForbiddenWords(c);
  });

  it("steer message shows sent then seen by the agent", async () => {
    const container = render(<StoryHarness />);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Steer it"]',
    );
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
    // Not in the conversation yet: the box says it's sent.
    expect(deliveries(container)).toEqual(["Sent"]);

    // In the conversation: the story line carries the state, once.
    const sentId = action.input.id as string;
    const idea = user("u0", "a task board for my team", at(1), at(1));
    act(() => set.messages([idea, user(sentId, "add a Ready column", at(7))]));
    expect(deliveries(container)).toEqual(["Sent"]);
    expect(
      container.querySelector('[data-line="steer"]')?.textContent,
    ).toContain("Sent");

    act(() =>
      set.messages([
        idea,
        user(sentId, "add a Ready column", at(7), atSec(7, 4)),
      ]),
    );
    expect(deliveries(container)).toEqual(["Seen by the agent"]);
    expectNoForbiddenWords(container);
  });

  it("a steer that never reaches the conversation is not delivered after 60 s", async () => {
    const container = render(<Harness />);
    await submit(container, "add a Ready column");
    expect(deliveries(container)).toEqual(["Sent"]);
    act(() => set.now(new Date(atSec(6, 5))));
    expect(deliveries(container)).toEqual(["Sent"]);
    act(() => set.now(new Date(atSec(6, 11))));
    expect(deliveries(container)).toEqual(["Not delivered yet"]);
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

  it("Continue resumes the change, then sends continue", async () => {
    const container = render(<Harness paused />);
    await act(async () => {
      click(button(container, "Continue"));
      await Promise.resolve();
    });
    expect(hoisted.dispatched.map((d) => [d.action.type, d.id])).toEqual([
      ["RESUME_CHANGE", PRODUCT_ID],
      ["ADD_USER_MESSAGE", SESSION_ID],
    ]);
    expect(hoisted.dispatched[1].action.input).toMatchObject({
      content: [{ type: "TEXT", text: "continue" }],
    });
    expect(String(hoisted.dispatched[1].action.input.id)).toMatch(
      new RegExp(`^${CONTINUE_ID_PREFIX}`),
    );
  });

  it("Continue retries continue once, then says so and stays resumed", async () => {
    hoisted.failMessages = 2;
    const container = render(<Harness paused />);
    await act(async () => {
      click(button(container, "Continue"));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(hoisted.dispatched.map((d) => d.action.type)).toEqual([
      "RESUME_CHANGE",
      "ADD_USER_MESSAGE",
      "ADD_USER_MESSAGE",
    ]);
    // Both tries carry the same message id (a late first one isn't doubled).
    expect(hoisted.dispatched[1].action.input.id).toBe(
      hoisted.dispatched[2].action.input.id,
    );
    expect(hoisted.toasts).toEqual([CONTINUE_NOT_SENT_TEXT]);
    // No PAUSE_CHANGE back: the change stays BUILDING for the steer box.
    expect(container.querySelector("input")?.disabled).toBe(false);
  });

  it("Continue sends continue on the second try", async () => {
    hoisted.failMessages = 1;
    const container = render(<Harness paused />);
    await act(async () => {
      click(button(container, "Continue"));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(hoisted.dispatched.map((d) => d.action.type)).toEqual([
      "RESUME_CHANGE",
      "ADD_USER_MESSAGE",
      "ADD_USER_MESSAGE",
    ]);
    expect(hoisted.toasts).toEqual([]);
  });

  it("a paused change shows Continue", () => {
    const container = render(<Harness paused />);
    expect(button(container, "Continue")).toBeDefined();
    // Steering stays possible while paused.
    expect(container.querySelector("input")?.disabled).toBe(false);
  });
});
