import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { forbiddenWordsIn } from "../test-utils/forbiddenWords.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import {
  buildingProduct,
  chat,
  reply,
  toolCall,
  user,
  atSec,
} from "./storyFixtures.js";
import {
  CONTINUE_ID_PREFIX,
  STUDIO_NOTE_ID_PREFIX,
  staleness,
  storyLines,
  type StoryLine,
} from "./storyModel.js";

function changeOf(product: ReturnType<typeof buildingProduct>) {
  const change = product.changes.find((c) => c.id === "c1");
  if (!change) throw new Error("no change");
  return change;
}

function kinds(lines: StoryLine[]) {
  return lines.map((l) =>
    l.kind === "milestone" ? `${l.mark} ${l.text}` : l.kind,
  );
}

function detailIds(line: StoryLine | undefined): string[] {
  return line && "detail" in line ? line.detail.map((m) => m.id) : [];
}

describe("storyLines", () => {
  it("messages fold under the milestone before them", () => {
    const product = buildingProduct();
    const conversation = chat(
      user("u0", "a task board for my team", at(1), at(1)),
      toolCall("a1", "spec-create", { name: "task" }, at(2)),
      toolCall("a2", "mastra_workspace_write_file", { path: "a.ts" }, at(4)),
      reply("a3", "Got it — the tasks have a due date now.", at(5)),
      toolCall(
        "a4",
        "mastra_workspace_write_file",
        { path: "src/QueueBoard.tsx" },
        at(7),
      ),
    );
    const lines = storyLines(
      product,
      changeOf(product),
      conversation,
      new Date(at(7)),
    );

    expect(kinds(lines)).toEqual([
      "idea",
      "✓ Planned 1 app · 7 features",
      "reply",
      "⟲ retried once on a backup model",
      "◐ Designing the task data",
    ]);
    const [idea, planned, , retried, active] = lines;
    expect(idea).toMatchObject({ text: "a task board for my team" });
    // The idea message and the work before the first milestone.
    expect(detailIds(idea)).toEqual(["u0", "a1"]);
    // Between the 10:03 and 10:06 milestones.
    expect(detailIds(planned)).toEqual(["a2", "a3"]);
    // After the last milestone: under the line in progress.
    expect(detailIds(retried)).toEqual([]);
    expect(detailIds(active)).toEqual(["a4"]);
    expect(active).toMatchObject({ doingNow: "writing QueueBoard.tsx…" });

    for (const line of lines) {
      if ("text" in line) expect(forbiddenWordsIn(line.text)).toEqual([]);
    }
  });

  it("steer messages carry their delivery; a last question is highlighted", () => {
    const product = buildingProduct();
    const change = changeOf(product);
    const sent = storyLines(
      product,
      change,
      chat(
        user("u0", "a task board", at(1), at(1)),
        reply("a1", "Working on it.", at(2)),
        user("u1", "add a Ready column", at(7)),
      ),
      new Date(atSec(7, 30)),
    );
    expect(sent.find((l) => l.kind === "steer")).toMatchObject({
      text: "add a Ready column",
      delivery: "sent",
    });

    const late = storyLines(
      product,
      change,
      chat(user("u0", "a task board", at(1), at(1)), user("u1", "hi", at(7))),
      new Date(atSec(8, 30)),
    );
    expect(late.find((l) => l.kind === "steer")).toMatchObject({
      delivery: "not-delivered",
    });

    const asked = storyLines(
      product,
      change,
      chat(
        user("u0", "a task board", at(1), at(1)),
        reply("a1", "Should tasks have owners?", at(2), at(2)),
      ),
      new Date(at(3)),
    );
    expect(asked.find((l) => l.kind === "reply")).toMatchObject({
      question: true,
    });
  });

  it("shows stuck, needs-you and paused states", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.startStep({ changeId: "c1", kind: "EDITORS", at: at(2) }),
        actions.markStuck({
          changeId: "c1",
          reason: "I'm stuck on the drag-and-drop.",
          tried: ["a library", "plain events"],
          at: at(3),
        }),
        actions.setStepAttention({
          changeId: "c1",
          kind: "EDITORS",
          status: "NEEDS_YOU",
          reason: "The preview is taking longer than usual.",
          at: at(4),
        }),
        actions.pauseChange({ changeId: "c1", at: at(5) }),
      ).state.global,
    );
    const lines = storyLines(product, changeOf(product), null, new Date(at(6)));
    expect(lines.map((l) => l.kind)).toEqual([
      "idea",
      "stuck",
      "attention",
      "paused",
    ]);
    expect(lines[1]).toMatchObject({ tried: ["a library", "plain events"] });
    expect(lines[2]).toMatchObject({
      text: "The preview is taking longer than usual.",
    });
  });
});

describe("check lines (Tests step)", () => {
  it("one line per check run; failures counted, fixing while building", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.startStep({ changeId: "c1", kind: "TESTS", at: at(2) }),
        actions.recordCheckRun({
          changeId: "c1",
          id: "r1",
          at: at(3),
          results: [
            { kind: "LINT", passed: true },
            { kind: "TYPECHECK", passed: true },
            {
              kind: "REDUCER_TESTS",
              passed: false,
              reason: "A task without a title is accepted.",
            },
            {
              kind: "SMOKE",
              passed: false,
              reason: "The board shows an error when it opens.",
            },
          ],
        }),
        actions.recordCheckRun({
          changeId: "c1",
          id: "r2",
          at: at(5),
          results: [
            { kind: "TYPECHECK", passed: true },
            { kind: "LINT", passed: true },
            { kind: "REDUCER_TESTS", passed: false, reason: "Still failing." },
          ],
        }),
      ).state.global,
    );
    const lines = storyLines(product, changeOf(product), null, new Date(at(6)));
    const checks = lines.filter((l) => l.kind === "checks");
    expect(checks).toEqual([
      {
        kind: "checks",
        id: "checks:r1",
        at: at(3),
        text: "Type check ✓ · Lint ✓ · Reducer tests ✕ · Preview renders ✕",
        failed: "2 checks failed",
        reasons: [
          "A task without a title is accepted.",
          "The board shows an error when it opens.",
        ],
      },
      {
        kind: "checks",
        id: "checks:r2",
        at: at(5),
        text: "Type check ✓ · Lint ✓ · Reducer tests ✕",
        failed: "1 check failed — fixing",
        reasons: ["Still failing."],
      },
    ]);
    for (const line of checks) {
      expect(
        forbiddenWordsIn([line.text, line.failed, ...line.reasons].join("\n")),
      ).toEqual([]);
    }
  });

  it("all passing has no failure line", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.recordCheckRun({
          changeId: "c1",
          id: "r1",
          at: at(3),
          results: [
            { kind: "GENERATE", passed: true },
            { kind: "TYPECHECK", passed: true },
          ],
        }),
      ).state.global,
    );
    const line = storyLines(
      product,
      changeOf(product),
      null,
      new Date(at(4)),
    ).find((l) => l.kind === "checks");
    expect(line).toMatchObject({
      text: "Code generated ✓ · Type check ✓",
      failed: null,
      reasons: [],
    });
  });
});

describe("auto-continue", () => {
  it("the supervisor's continue after a capped turn is not a steer", () => {
    const product = buildingProduct();
    const capped = {
      ...reply("a1", "Working.", at(2), at(3)),
      finishReason: "tool-calls",
    };
    const lines = storyLines(
      product,
      changeOf(product),
      chat(
        user("u0", "a task board", at(1), at(1)),
        capped,
        user("u1", "continue", atSec(3, 1), atSec(3, 2)),
      ),
      new Date(at(4)),
    );
    expect(lines.filter((l) => l.kind === "steer")).toEqual([]);
  });

  it("Continue's message is not a steer, even after a message sent while paused", () => {
    const product = buildingProduct();
    const lines = storyLines(
      product,
      changeOf(product),
      chat(
        user("u0", "a task board", at(1), at(1)),
        { ...reply("a1", "Working.", at(2), at(3)), finishReason: "stop" },
        // Sent while paused: its turn stopped at its first step, no reply.
        user("m1", "make the cards blue", atSec(3, 1), atSec(3, 2)),
        user(`${CONTINUE_ID_PREFIX}1`, "continue", atSec(3, 5), atSec(3, 6)),
      ),
      new Date(at(4)),
    );
    expect(lines.flatMap((l) => (l.kind === "steer" ? [l.text] : []))).toEqual([
      "make the cards blue",
    ]);
  });

  it("the Studio's note to the agent is not a steer (D6 blocked launch)", () => {
    const product = buildingProduct();
    const lines = storyLines(
      product,
      changeOf(product),
      chat(
        user("u0", "a task board", at(1), at(1)),
        { ...reply("a1", "Done.", at(2), at(3)), finishReason: "stop" },
        user(
          `${STUDIO_NOTE_ID_PREFIX}1`,
          "Make this change additive: keep existing fields and operations, add new ones as optional.",
          atSec(3, 1),
          atSec(3, 2),
        ),
        user("u2", "make the cards blue", atSec(3, 5), atSec(3, 6)),
      ),
      new Date(at(4)),
    );
    expect(lines.flatMap((l) => (l.kind === "steer" ? [l.text] : []))).toEqual([
      "make the cards blue",
    ]);
  });

  it("the customer's own continue still shows", () => {
    const product = buildingProduct();
    const lines = storyLines(
      product,
      changeOf(product),
      chat(
        user("u0", "a task board", at(1), at(1)),
        { ...reply("a1", "Done.", at(2), at(3)), finishReason: "stop" },
        user("u1", "continue", atSec(3, 1)),
      ),
      new Date(atSec(3, 5)),
    );
    expect(lines.filter((l) => l.kind === "steer")).toMatchObject([
      { text: "continue" },
    ]);
  });
});

describe("staleness", () => {
  const product = buildingProduct();
  const change = changeOf(product);
  const conversation = chat(
    user("u0", "a task board", at(1), at(1)),
    toolCall("a1", "Write", { path: "a.ts" }, at(7)),
  );

  it("a waiting line appears after 30 s without news", () => {
    const fresh = new Date(atSec(7, 25));
    const lines = storyLines(product, change, conversation, fresh);
    expect(staleness(lines, { working: true }, fresh)).toBeNull();

    const quiet = new Date(atSec(7, 45));
    const waiting = staleness(
      storyLines(product, change, conversation, quiet),
      { working: true },
      quiet,
    );
    expect(waiting).toMatchObject({
      kind: "waiting",
      text: "Still working on it — last update 45 s ago.",
    });
  });

  it("no waiting line while the agent isn't working", () => {
    const quiet = new Date(at(20));
    const lines = storyLines(product, change, conversation, quiet);
    expect(staleness(lines, { working: false }, quiet)).toBeNull();
  });
});
