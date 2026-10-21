// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  render,
  rerender,
  typeInto,
} from "../test-utils/render.js";
import {
  PRODUCT_ID,
  SESSION_ID,
  at,
  buildingOps,
  productDoc,
} from "../test-utils/studioFixtures.js";
import { StoryPane, PAUSED_TEXT } from "./StoryPane.js";
import {
  atSec,
  buildingProduct,
  chat,
  reply,
  toolCall,
  user,
} from "./storyFixtures.js";

const hoisted = vi.hoisted(() => ({
  dispatched: [] as { action: { type: string }; id: string }[],
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => undefined,
  dispatchActions: (action: { type: string }, id: string) => {
    hoisted.dispatched.push({ action, id });
    return Promise.resolve();
  },
}));

beforeEach(() => {
  hoisted.dispatched = [];
});

function changeOf(product: ReturnType<typeof buildingProduct>) {
  const change = product.changes.find((c) => c.id === "c1");
  if (!change) throw new Error("no change");
  return change;
}

describe("StoryPane", () => {
  it("an existing Studio's closed work asks for the next change instead of steering it", () => {
    const product = readProduct(
      productDoc(
        actions.initProduct({
          name: "Old app",
          idea: "old work",
          createdAt: at(0),
        }),
        actions.adoptExisting({
          changeId: "c0",
          request: "Before versions",
          chatSessionIds: [SESSION_ID],
          doneSteps: ["PLAN"],
          at: at(0),
        }),
      ).state.global,
    );
    const change = product.changes[0];
    const onStartChange = vi.fn(() => Promise.resolve());
    const container = render(
      <StoryPane
        product={product}
        change={change}
        chat={chat(user("u0", "build me a todo app", at(1), at(1)))}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(at(5))}
        onStartChange={onStartChange}
      />,
    );
    expect(container.querySelector('input[aria-label="Steer it"]')).toBeNull();
    expect(button(container, "Pause")).toBeUndefined();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="What should change?"]',
    );
    typeInto(input, "add due dates");
    click(button(container, "Send"));
    expect(onStartChange).toHaveBeenCalledWith("add due dates");
    // Nothing is written into the old conversation.
    expect(hoisted.dispatched).toEqual([]);
    expectNoForbiddenWords(container);
  });

  it("tells the build as a story: idea, milestones, doing now, replies", () => {
    const product = buildingProduct();
    const container = render(
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={chat(
          user("u0", "a task board for my team", at(1), at(1)),
          toolCall("a1", "spec-create", { name: "task" }, at(2)),
          reply("a2", "Got it — planning Task board.", at(2)),
          user("u1", "add a Ready column", at(6), atSec(6, 5)),
          toolCall("a3", "Write", { path: "src/QueueBoard.tsx" }, at(7)),
        )}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(atSec(7, 10))}
      />,
    );
    const text = container.textContent;
    expect(text).toContain("“a task board for my team”");
    expect(text).toContain("✓Planned 1 app · 7 features");
    expect(text).toContain("⟲retried once on a backup model");
    expect(text).toContain("◐Designing the task data");
    expect(text).toContain("writing QueueBoard.tsx…");
    expect(text).toContain("Got it — planning Task board.");
    expect(text).toContain("add a Ready column");
    expect(text).toContain("Seen by the agent");
    expectNoForbiddenWords(container);

    // The idea line expands to the raw detail before the first milestone.
    const idea = container.querySelector('[data-line="idea"] button');
    expect(idea?.getAttribute("aria-expanded")).toBe("false");
    click(idea);
    expect(idea?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[data-line="idea"]')?.textContent,
    ).toContain("spec-create");
  });

  it("shows a waiting line when tool calls keep coming but the story reads the same", () => {
    const product = buildingProduct();
    const pane = (calls: ReturnType<typeof toolCall>[], now: string) => (
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={chat(user("u0", "a task board", at(1), at(1)), ...calls)}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(now)}
      />
    );
    const first = toolCall("a1", "spec-update", { name: "Brief" }, atSec(7, 0));
    const container = render(pane([first], atSec(7, 0)));
    const waitingLine = () => container.querySelector('[data-line="waiting"]');
    expect(waitingLine()).toBeNull();
    // A second spec call 15 s later: same "working on the design…" line.
    const second = toolCall(
      "a2",
      "spec-update",
      { name: "Brief" },
      atSec(7, 15),
    );
    rerender(container, pane([first, second], atSec(7, 15)));
    expect(waitingLine()).toBeNull();
    rerender(container, pane([first, second], atSec(7, 25)));
    expect(waitingLine()?.textContent).toContain(
      "Still working on it — last update 25 s ago.",
    );
  });

  it("shows a waiting line when there is no news for 20 s", () => {
    const product = buildingProduct();
    const container = render(
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={chat(
          user("u0", "a task board", at(1), at(1)),
          toolCall("a1", "reactor-project-check", {}, at(7)),
        )}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(at(8))}
      />,
    );
    expect(container.textContent).toContain("running the checks…");
    expect(container.textContent).toContain(
      "Still working on it — last update 60 s ago.",
    );
    expectNoForbiddenWords(container);
  });

  it("shows the Tests step's checks as they run", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.startStep({ changeId: "c1", kind: "TESTS", at: at(2) }),
        actions.recordCheckRun({
          changeId: "c1",
          id: "r1",
          at: at(3),
          results: [
            { kind: "TYPECHECK", passed: true },
            { kind: "LINT", passed: true },
            {
              kind: "REDUCER_TESTS",
              passed: false,
              reason: "2 of 14 task rules failed.",
            },
          ],
        }),
      ).state.global,
    );
    const container = render(
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={null}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(atSec(3, 10))}
      />,
    );
    const line = container.querySelector('[data-line="checks"]');
    expect(line?.textContent).toContain(
      "Type check ✓ · Lint ✓ · Reducer tests ✕",
    );
    expect(line?.textContent).toContain("1 check failed — fixing");
    expect(line?.textContent).toContain("2 of 14 task rules failed.");
    expectNoForbiddenWords(container);
  });

  it("stuck offers ways forward; paused offers Continue", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.markStuck({
          changeId: "c1",
          reason: "I'm stuck on the drag-and-drop. I tried 3 ways.",
          tried: ["a library", "plain events", "a simpler list"],
          at: at(3),
        }),
        actions.pauseChange({ changeId: "c1", at: at(4) }),
      ).state.global,
    );
    const container = render(
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={null}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(at(5))}
      />,
    );
    expect(container.textContent).toContain("plain events");
    expect(container.textContent).toContain(PAUSED_TEXT);
    expectNoForbiddenWords(container);

    click(button(container, "Try a simpler version"));
    expect(hoisted.dispatched[0]).toMatchObject({
      id: SESSION_ID,
      action: { type: "ADD_USER_MESSAGE" },
    });

    const story = container.querySelector('[data-line="paused"]');
    click(story?.querySelector("button"));
    expect(hoisted.dispatched[1]).toMatchObject({
      id: PRODUCT_ID,
      action: { type: "RESUME_CHANGE" },
    });
  });
});

describe("StoryPane layers", () => {
  function pane(props: Partial<Parameters<typeof StoryPane>[0]> = {}) {
    const product = buildingProduct();
    return (
      <StoryPane
        product={product}
        change={changeOf(product)}
        chat={chat(
          user("u0", "a task board for my team", at(1), at(1)),
          toolCall("a1", "spec-create", { name: "task" }, at(2)),
          reply("a2", "Got it — planning Task board.", at(2)),
          toolCall("a3", "Write", { path: "src/QueueBoard.tsx" }, at(7)),
        )}
        sessionId={SESSION_ID}
        productId={PRODUCT_ID}
        now={new Date(atSec(7, 10))}
        {...props}
      />
    );
  }

  it("defaults to Activity", () => {
    const container = render(pane());
    expect(
      container
        .querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("activity");
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("Activity");
    expectNoForbiddenWords(container);
  });

  it("switching to Raw shows every tool call", () => {
    const container = render(pane());
    expect(container.textContent).not.toContain("spec-create");
    click(button(container, "Raw"));
    const list = container.querySelector("[data-story-layer]");
    expect(list?.getAttribute("data-story-layer")).toBe("raw");
    expect(container.querySelectorAll("[data-story-layer]")).toHaveLength(1);
    expect(container.textContent).toContain("spec-create");
    expect(container.textContent).toContain("QueueBoard.tsx");
  });

  it("Outcome shows one sentence per milestone", () => {
    const container = render(pane({ layer: "outcome" }));
    const lines = container.querySelectorAll("[data-story-line]");
    const text = container.textContent;
    expect(
      container
        .querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("outcome");
    expect(text).toContain("Planned 1 app · 7 features");
    expect(text).not.toContain("Got it — planning");
    expect(lines.length).toBeLessThanOrEqual(4);
    expectNoForbiddenWords(container);
  });

  it("is controlled when a layer is given and reports changes", () => {
    const onLayerChange = vi.fn();
    const container = render(pane({ layer: "outcome", onLayerChange }));
    click(button(container, "Activity"));
    expect(onLayerChange).toHaveBeenCalledWith("activity");
  });

  it("Copy all is only in Raw", () => {
    const container = render(pane());
    expect(button(container, "Copy all")).toBeUndefined();
    click(button(container, "Outcome"));
    expect(button(container, "Copy all")).toBeUndefined();
    click(button(container, "Raw"));
    expect(button(container, "Copy all")).toBeDefined();
  });
});
