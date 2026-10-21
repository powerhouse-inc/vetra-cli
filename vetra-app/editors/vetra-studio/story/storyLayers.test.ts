import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { atSec, chat, reply, toolCall, user } from "./storyFixtures.js";
import {
  DEFAULT_LAYER,
  layerLines,
  outcomeLines,
  type StoryLayer,
} from "./storyLayers.js";
import { storyLines } from "./storyModel.js";

type Op = ReturnType<typeof actions.startStep>;

function build(extra: Op[] = [], withStep = true) {
  const product = readProduct(
    productDoc(
      ...buildingOps(),
      ...(withStep
        ? [actions.startStep({ changeId: "c1", kind: "DATA", at: at(2) })]
        : []),
      ...extra,
    ).state.global,
  );
  const change = product.changes.find((c) => c.id === "c1");
  if (!change) throw new Error("no change");
  return { product, change };
}

const milestone = (
  id: string,
  minute: number,
  text: string,
  outcome?: string,
) =>
  actions.addMilestone({
    changeId: "c1",
    id,
    text,
    at: at(minute),
    ...(outcome ? { outcome } : {}),
  }) as unknown as Op;

const run = (id: string, minute: number, passed: boolean) =>
  actions.recordCheckRun({
    changeId: "c1",
    id,
    at: at(minute),
    results: [
      { kind: "TYPECHECK", passed: true },
      passed
        ? { kind: "LINT", passed: true }
        : { kind: "LINT", passed: false, reason: "Unused thing." },
    ],
  }) as unknown as Op;

const NOW = new Date(at(30));
function layer(
  extra: Op[],
  chatValue: ReturnType<typeof chat> | null,
  which: StoryLayer,
) {
  const { product, change } = build(extra);
  const lines = storyLines(product, change, chatValue, NOW);
  return { lines, out: layerLines(lines, change, which), change };
}

const tools: [string, Record<string, unknown>][] = [
  ["mastra_workspace_read_file", { path: "a.ts" }],
  ["spec-create", { name: "Task" }],
  ["mastra_workspace_write_file", { path: "x.ts", content: "" }],
];

function manyCalls() {
  const msgs = [user("u0", "a task board", atSec(0, 30))];
  for (let i = 0; i < 60; i++) {
    const [name, args] = tools[i % tools.length];
    msgs.push(
      toolCall(`t${i}`, name, args, atSec(1 + Math.floor(i / 6), i % 6)),
    );
  }
  for (let i = 0; i < 6; i++) {
    msgs.push(reply(`r${i}`, `Progress ${i}.`, atSec(1 + i * 2, 30)));
  }
  return msgs;
}

describe("layers", () => {
  it("a 60-step change shows at most 12 activity lines", () => {
    const { out, lines } = layer(
      [
        milestone("m1", 2, "One"),
        milestone("m2", 4, "Two"),
        milestone("m3", 6, "Three"),
        milestone("m4", 8, "Four"),
        milestone("m5", 10, "Five"),
        run("k1", 4, false),
        run("k2", 5, true),
        run("k3", 8, false),
        run("k4", 9, true),
      ],
      chat(...manyCalls()),
      DEFAULT_LAYER,
    );
    expect(lines.length).toBeGreaterThan(12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.filter((l) => l.kind === "checks")).toHaveLength(0);
    const m2 = out.find((l) => l.kind === "milestone" && l.id === "m2");
    expect(m2 && "summary" in m2 && m2.summary).toMatch(
      /checks passed after 2 tries/,
    );
  });

  it("latest failing run stays its own line while an earlier failure folds", () => {
    const { out } = layer(
      [milestone("m1", 3, "One"), run("k1", 4, false), run("k2", 5, false)],
      null,
      "activity",
    );
    const checks = out.filter((l) => l.kind === "checks");
    expect(checks.map((l) => l.id)).toEqual(["checks:k2"]);
  });

  it("question and the reply to a steer stay in activity", () => {
    const msgs = [
      user("u0", "a task board", atSec(0, 30)),
      reply("r0", "Reading things.", atSec(1, 0)),
      reply("r1", "Still reading.", atSec(1, 10)),
      user("u1", "make it blue", atSec(2, 0)),
      reply("r2", "Blue it is.", atSec(2, 10)),
      reply("r3", "Working on the colours.", atSec(2, 20)),
      reply("r4", "Which blue do you want?", atSec(2, 30)),
    ];
    const { out } = layer(
      [milestone("m1", 1, "One")],
      chat(...msgs),
      "activity",
    );
    const ids = out.filter((l) => l.kind === "reply").map((l) => l.id);
    expect(ids).toEqual(["r2", "r4"]);
    expect(out.some((l) => l.kind === "steer")).toBe(true);
  });

  it("outcome layer falls back to the milestone title", () => {
    const { change } = build([
      milestone("m1", 3, "Planned 1 app", "Your task board has a plan."),
      milestone("m2", 4, "Wired the data"),
    ]);
    expect(outcomeLines(change).map((l) => l.text)).toEqual([
      "Your task board has a plan.",
      "Wired the data",
    ]);
    const { out } = layer(
      [milestone("m1", 3, "Planned 1 app", "Your task board has a plan.")],
      chat(
        user("u0", "x", atSec(0, 30)),
        toolCall("t", "spec-create", { name: "A" }, atSec(4, 0)),
      ),
      "outcome",
    );
    expect(out.map((l) => l.kind)).toEqual(["idea", "milestone"]);
    expect(out[1]).toMatchObject({
      text: "Your task board has a plan.",
      detail: [],
    });
  });

  it("raw layer equals storyLines", () => {
    const { lines, out } = layer(
      [milestone("m1", 3, "One"), run("k1", 4, false)],
      chat(user("u0", "x", atSec(0, 30)), reply("r", "Hi.", atSec(5, 0))),
      "raw",
    );
    expect(out).toEqual(lines);
  });

  it("stuck and needs-you stay in every layer", () => {
    const stuck = actions.markStuck({
      changeId: "c1",
      reason: "Cannot reach it.",
      tried: ["a"],
      at: at(6),
    }) as unknown as Op;
    const msgs = chat(
      user("u0", "x", atSec(0, 30)),
      reply("r1", "Which colour?", atSec(7, 0), atSec(7, 1)),
    );
    for (const which of ["outcome", "activity", "raw"] as const) {
      const { out } = layer([milestone("m1", 3, "One"), stuck], msgs, which);
      expect(out.some((l) => l.kind === "stuck")).toBe(true);
    }
    const q = layer([milestone("m1", 3, "One")], null, "outcome");
    expect(q.out.some((l) => l.kind === "milestone")).toBe(true);
    const asked = layer([milestone("m1", 3, "One")], msgs, "outcome");
    expect(asked.out.some((l) => l.kind === "reply")).toBe(true);
  });
});
