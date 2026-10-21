// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
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

  it("shows a waiting line when there is no news for 30 s", () => {
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
