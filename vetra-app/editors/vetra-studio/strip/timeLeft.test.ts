import {
  actions,
  type Change,
  type StudioProductAction,
} from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { stripChange } from "./stripModel.js";
import { PHASE_AVERAGES, TAKING_LONGER, timeLeft } from "./timeLeft.js";

const AVERAGES = { model: 60, editor: 120, check: 10 };

function changeAfter(...ops: StudioProductAction[]): Change {
  const product = readProduct(
    productDoc(...buildingOps(), ...ops).state.global,
  );
  const change = stripChange(product);
  if (!change) throw new Error("no change");
  return change;
}

function minutes(text: string | null): number {
  if (text === TAKING_LONGER) return 0;
  const match = /^~(\d+) min left$/.exec(text ?? "");
  if (!match) throw new Error(`not an estimate: ${text}`);
  return Number(match[1]);
}

const planDone = actions.completeStep({
  changeId: "c1",
  kind: "PLAN",
  at: at(2),
});

function run(id: string, minute: number, kinds: string[]): StudioProductAction {
  return actions.recordCheckRun({
    changeId: "c1",
    id,
    at: at(minute),
    results: kinds.map((kind) => ({
      kind: kind as "GENERATE",
      passed: true,
    })),
  });
}

describe("timeLeft", () => {
  it("no estimate before the plan exists", () => {
    expect(timeLeft(changeAfter(), AVERAGES, new Date(at(2)))).toBeNull();
    const planning = changeAfter(
      actions.startStep({ changeId: "c1", kind: "PLAN", at: at(1) }),
    );
    expect(timeLeft(planning, AVERAGES, new Date(at(2)))).toBeNull();
    expect(timeLeft(null, AVERAGES, new Date(at(2)))).toBeNull();
  });

  it("shows the planned work left in whole minutes, rounded up", () => {
    // 3 models × 60 + 3 screens × 120 + 1 check × 10 = 550 s → 10 min.
    const change = changeAfter(planDone);
    expect(timeLeft(change, AVERAGES, new Date(at(2)))).toBe("~10 min left");
    expect(
      timeLeft(change, AVERAGES, new Date(Date.parse(at(2)) + 30_000)),
    ).toBe("~9 min left");
  });

  it("estimate switches to taking longer than usual instead of going negative", () => {
    const change = changeAfter(planDone);
    expect(timeLeft(change, AVERAGES, new Date(at(11)))).toBe("~1 min left");
    for (const minute of [12, 15, 40]) {
      expect(timeLeft(change, AVERAGES, new Date(at(minute)))).toBe(
        TAKING_LONGER,
      );
    }
  });

  it("estimate never increases when a unit completes", () => {
    const steps: [number, StudioProductAction[]][] = [
      [2, [planDone]],
      [3, [actions.startStep({ changeId: "c1", kind: "DATA", at: at(3) })]],
      [
        4,
        [
          actions.countStep({
            changeId: "c1",
            kind: "DATA",
            done: 1,
            total: 3,
          }),
        ],
      ],
      [
        6,
        [
          actions.countStep({
            changeId: "c1",
            kind: "DATA",
            done: 2,
            total: 3,
          }),
        ],
      ],
      // Data finishes late: the screens still ahead would raise the number.
      [
        8,
        [
          run("r1", 8, ["GENERATE"]),
          actions.completeStep({ changeId: "c1", kind: "DATA", at: at(8) }),
          actions.startStep({ changeId: "c1", kind: "EDITORS", at: at(8) }),
        ],
      ],
      [
        9,
        [
          actions.countStep({
            changeId: "c1",
            kind: "EDITORS",
            done: 1,
            total: 3,
          }),
        ],
      ],
      [
        10,
        [
          actions.countStep({
            changeId: "c1",
            kind: "EDITORS",
            done: 3,
            total: 3,
          }),
        ],
      ],
    ];
    const ops: StudioProductAction[] = [];
    let prev: string | null = null;
    const shown: number[] = [];
    for (const [minute, next] of steps) {
      ops.push(...next);
      prev = timeLeft(
        changeAfter(...ops),
        AVERAGES,
        new Date(at(minute)),
        prev,
      );
      shown.push(minutes(prev));
    }
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]).toBeLessThanOrEqual(shown[i - 1]);
    }
    expect(shown.every((m) => m >= 0)).toBe(true);
  });

  it("a reopened step never raises the estimate", () => {
    const base = [
      planDone,
      run("r1", 3, ["GENERATE"]),
      actions.completeStep({ changeId: "c1", kind: "DATA", at: at(3) }),
      actions.startStep({ changeId: "c1", kind: "EDITORS", at: at(3) }),
    ];
    const before = timeLeft(changeAfter(...base), AVERAGES, new Date(at(6)));
    expect(before).toBe("~4 min left");
    const back = changeAfter(
      ...base,
      actions.reopenStep({
        changeId: "c1",
        kind: "DATA",
        reason: "the due-date check failed",
        at: at(6),
      }),
    );
    // Without the earlier estimate it would read ~8 min.
    expect(timeLeft(back, AVERAGES, new Date(at(6)))).toBe("~8 min left");
    expect(timeLeft(back, AVERAGES, new Date(at(6)), before)).toBe(
      TAKING_LONGER,
    );
    // Once slower than usual, it doesn't come back with a bigger number.
    expect(timeLeft(back, AVERAGES, new Date(at(7)), TAKING_LONGER)).toBe(
      TAKING_LONGER,
    );
  });

  it("a reopened plan keeps the estimate from resetting to nothing", () => {
    const back = changeAfter(
      planDone,
      actions.reopenStep({
        changeId: "c1",
        kind: "PLAN",
        reason: "a new feature",
        at: at(3),
      }),
    );
    expect(timeLeft(back, AVERAGES, new Date(at(3)))).toBeNull();
    expect(timeLeft(back, AVERAGES, new Date(at(3)), "~8 min left")).toBe(
      TAKING_LONGER,
    );
  });

  it("nothing to estimate once the planned work is done or the change stopped", () => {
    const done = changeAfter(
      planDone,
      run("r1", 3, ["GENERATE", "TYPECHECK", "LINT", "REDUCER_TESTS", "SMOKE"]),
      actions.completeStep({ changeId: "c1", kind: "DATA", at: at(3) }),
      actions.completeStep({ changeId: "c1", kind: "EDITORS", at: at(3) }),
      actions.completeStep({ changeId: "c1", kind: "TESTS", at: at(3) }),
    );
    expect(timeLeft(done, AVERAGES, new Date(at(4)))).toBeNull();
    const stopped = { ...changeAfter(planDone), status: "FAILED" as const };
    expect(timeLeft(stopped, AVERAGES, new Date(at(2)))).toBeNull();
  });

  it("without a measurement for the work left it keeps what was shown", () => {
    const change = changeAfter(planDone);
    expect(timeLeft(change, { model: 60 }, new Date(at(2)))).toBeNull();
    expect(
      timeLeft(change, { model: 60 }, new Date(at(2)), "~5 min left"),
    ).toBe("~5 min left");
  });

  it("ships measured averages for models, screens and checks", () => {
    expect(PHASE_AVERAGES.model).toBeGreaterThan(0);
    expect(PHASE_AVERAGES.editor).toBeGreaterThan(0);
    expect(PHASE_AVERAGES.check).toBeGreaterThan(0);
  });
});
