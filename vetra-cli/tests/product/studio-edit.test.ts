import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ObservedCheck } from "../../src/product/check-results.js";
import { discardDraft, snapshot } from "../../src/launch/git-versions.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import {
  applyStudioEdit,
  type StudioEditContext,
  type StudioEditDeps,
} from "../../src/product/studio-edit.js";
import { newRequestsMemory, requestsPass } from "../../src/triggers/product-requests.js";
import { AT, a, launchHarness, makeReady, type LaunchHarness } from "../launch/orchestrator-helpers.js";

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** A Studio whose launches commit and tag for real; Version 1 is live, no change open. */
async function liveStudio(): Promise<LaunchHarness> {
  const h = await launchHarness({ snapshot, discardDraft });
  write(h.workdir, "todo/powerhouse.config.json", "{}\n");
  write(h.workdir, "todo/src/model.ts", "export const v = 1;\n");
  await makeReady(h);
  expect(await requestsPass(h.octx, newRequestsMemory())).toBe("auto-launch");
  expect((await h.state()).liveVersion).toBe(1);
  return h;
}

const PASSING: ObservedCheck[] = [
  { kind: "TYPECHECK", passed: true, reason: null },
  { kind: "LINT", passed: true, reason: null },
  { kind: "REDUCER_TESTS", passed: true, reason: null },
  { kind: "SMOKE", passed: true, reason: null },
];

interface Recorded {
  events: string[];
  notes: Array<{ session: string; text: string }>;
}

function editContext(
  h: LaunchHarness,
  over: Partial<StudioEditDeps> = {},
  extra: Partial<StudioEditContext> = {},
): { ctx: StudioEditContext; rec: Recorded } {
  const rec: Recorded = { events: [], notes: [] };
  const ctx: StudioEditContext = {
    ...h.ctx,
    workdir: h.workdir,
    runProcess: async () => ({ success: true, output: "" }),
    now: () => new Date(AT),
    editDeps: {
      generate: async (base) => {
        rec.events.push(`generate ${path.basename(base)}`);
        return { kind: "GENERATE", passed: true, reason: null };
      },
      check: async (base) => {
        rec.events.push(`check ${path.basename(base)}`);
        return PASSING;
      },
      messageAgent: async (_ctx, session, text) => {
        rec.notes.push({ session, text });
      },
      ...over,
    },
    ...extra,
  };
  return { ctx, rec };
}

/** An edit that sets the model's value to `v`. */
function edit(v: number, milestone = `Set the value to ${v}`) {
  return {
    request: `make the value ${v}`,
    milestone,
    outcome: `The value is now ${v}.`,
    async write(workdir: string): Promise<string[]> {
      write(workdir, "todo/src/model.ts", `export const v = ${v};\n`);
      return ["todo/src/model.ts"];
    },
  };
}

describe("applyStudioEdit", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("starts a change without an agent turn and makes it ready when checks pass", async () => {
    h = await liveStudio();
    // A stray edit from before: the new change starts from the live code, the stray is kept aside.
    write(h.workdir, "todo/src/stray.ts", "export const stray = true;\n");
    const { ctx, rec } = editContext(h);

    const result = await applyStudioEdit(ctx, edit(2));

    const s = await h.state();
    const change = s.changes.find((c) => c.id === result.changeId)!;
    expect(s.changes).toHaveLength(2);
    expect(s.activeChangeId).toBe(result.changeId);
    expect(change).toMatchObject({
      kind: "CHANGE",
      request: "make the value 2",
      status: "READY",
      chatSessionId: null,
      chatSessionIds: [],
    });
    expect(change.steps.map((st) => [st.kind, st.status])).toEqual([["TESTS", "DONE"]]);
    expect(change.milestones).toEqual([
      expect.objectContaining({ text: "Set the value to 2", outcome: "The value is now 2." }),
    ]);
    expect(change.checkRuns.flatMap((r) => r.results.map((x) => x.kind)).sort()).toEqual(
      ["GENERATE", "LINT", "REDUCER_TESTS", "SMOKE", "TYPECHECK"],
    );
    expect(result.checksPassed).toBe(true);
    expect(rec.events).toEqual(["generate todo", "check todo"]);
    expect(rec.notes).toEqual([]);

    // The edit is an ordinary commit by the Studio, holding only the edited file.
    expect(result.sha).toBe(git(h.workdir, "rev-parse", "HEAD"));
    expect(git(h.workdir, "log", "-1", "--format=%s|%an")).toBe("Set the value to 2|vetra-studio[bot]");
    expect(git(h.workdir, "show", "--name-only", "--format=", "HEAD")).toBe("todo/src/model.ts");
    expect(fs.readFileSync(path.join(h.workdir, "todo/src/model.ts"), "utf8")).toBe("export const v = 2;\n");
    expect(fs.existsSync(path.join(h.workdir, "todo/src/stray.ts"))).toBe(false);
    expect(git(h.workdir, "for-each-ref", "--format=%(refname)", "refs/vetra/unsaved/")).not.toBe("");
  });

  it("joins the open change instead of starting one", async () => {
    h = await liveStudio();
    await dispatchProduct(h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "add tags", chatSessionId: "session-2", startedAt: AT }),
      a.planSteps({ changeId: "change-2", steps: [{ kind: "DATA", total: null }, { kind: "LIVE", total: null }] }),
      a.startStep({ changeId: "change-2", kind: "DATA", at: AT }),
    ]);
    const { ctx, rec } = editContext(h);

    const result = await applyStudioEdit(ctx, edit(3));

    const s = await h.state();
    expect(result.changeId).toBe("change-2");
    expect(s.changes).toHaveLength(2);
    const change = s.changes.find((c) => c.id === "change-2")!;
    expect(change.request).toBe("add tags");
    expect(change.status).toBe("BUILDING");
    // The agent's plan is left as it is.
    expect(change.steps.map((st) => [st.kind, st.status])).toEqual([
      ["DATA", "WORKING"],
      ["LIVE", "NOT_STARTED"],
    ]);
    expect(change.milestones.map((m) => m.text)).toEqual(["Set the value to 3"]);
    expect(change.checkRuns.length).toBeGreaterThan(0);
    expect(rec.events).toContain("check todo");
    expect(git(h.workdir, "log", "-1", "--format=%s")).toBe("Set the value to 3");
  });

  it("failing checks put the change on needs-you and notify the agent", async () => {
    h = await liveStudio();
    const failing: ObservedCheck[] = [
      { kind: "TYPECHECK", passed: false, reason: "1 type error, first in editors/app.tsx line 3." },
      { kind: "LINT", passed: true, reason: null },
      { kind: "REDUCER_TESTS", passed: true, reason: null },
      { kind: "SMOKE", passed: false, reason: "A screen didn't load: editors/app.tsx." },
    ];
    const { ctx, rec } = editContext(h, { check: async () => failing }, { chatSessionId: "session-9" });

    const result = await applyStudioEdit(ctx, edit(4));

    expect(result.checksPassed).toBe(false);
    const change = (await h.state()).changes.find((c) => c.id === result.changeId)!;
    expect(change.status).toBe("BUILDING");
    expect(change.chatSessionIds).toEqual(["session-9"]);
    expect(change.steps).toEqual([
      expect.objectContaining({
        kind: "TESTS",
        status: "NEEDS_YOU",
        reason: "1 type error, first in editors/app.tsx line 3.",
      }),
    ]);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0].session).toBe("session-9");
    expect(rec.notes[0].text).toContain("1 type error, first in editors/app.tsx line 3.");
    expect(rec.notes[0].text).toContain("Set the value to 4");
    // The edit itself is kept: it is a version of the code like any other.
    expect(git(h.workdir, "log", "-1", "--format=%s")).toBe("Set the value to 4");
  });

  it("edits are serialised", async () => {
    h = await liveStudio();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ctx, rec } = editContext(h);
    const first = edit(5);
    const slow = {
      ...first,
      async write(workdir: string) {
        rec.events.push("write 5 start");
        await gate;
        const files = await first.write(workdir);
        rec.events.push("write 5 end");
        return files;
      },
    };
    const second = edit(6);
    const tracked = {
      ...second,
      async write(workdir: string) {
        rec.events.push("write 6 start");
        return second.write(workdir);
      },
    };

    const p1 = applyStudioEdit(ctx, slow);
    const p2 = applyStudioEdit(ctx, tracked);
    for (let i = 0; i < 200 && !rec.events.includes("write 5 start"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // The second edit waits while the first one is still writing.
    await new Promise((r) => setTimeout(r, 200));
    expect(rec.events).toEqual(["write 5 start"]);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(rec.events.indexOf("write 6 start")).toBeGreaterThan(rec.events.indexOf("check todo"));
    // The second edit joins the change the first one started.
    expect(r2.changeId).toBe(r1.changeId);
    const s = await h.state();
    expect(s.changes).toHaveLength(2);
    expect(s.changes[1].milestones.map((m) => m.text)).toEqual(["Set the value to 5", "Set the value to 6"]);
    expect(git(h.workdir, "log", "-2", "--format=%s")).toBe("Set the value to 6\nSet the value to 5");
  });
});
