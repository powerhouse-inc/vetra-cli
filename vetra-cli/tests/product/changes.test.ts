import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  discardDraft,
  draftMatches,
  snapshot,
} from "../../src/launch/git-versions.js";
import { awaitsBase, liveTag, prepareChangeBase } from "../../src/product/changes.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { newRequestsMemory, requestsPass } from "../../src/triggers/product-requests.js";
import { AT, a, launchHarness, makeReady, type LaunchHarness } from "../launch/orchestrator-helpers.js";

const BY = "did:pkh:eip155:1:0xowner";

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(root: string, rel: string): string | null {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** A Studio whose launches commit and tag for real; Version 1 is live. */
async function liveStudio(): Promise<LaunchHarness> {
  const h = await launchHarness({ snapshot, discardDraft });
  write(h.workdir, "todo/powerhouse.config.json", "{}\n");
  write(h.workdir, "todo/src/model.ts", "export const v = 1;\n");
  write(h.workdir, "specs/product/idea.md", "# Idea\n");
  await makeReady(h);
  expect(await requestsPass(h.octx, newRequestsMemory())).toBe("auto-launch");
  expect((await h.state()).liveVersion).toBe(1);
  return h;
}

/** What the Studio's `startChange` writes to the product: a new change with its own conversation. */
async function startChange(h: LaunchHarness, id: string, sessionId: string, kind: "CHANGE" | "UNDO" = "CHANGE") {
  await dispatchProduct(h.ctx, [
    a.startChange({ id, kind, request: `request for ${id}`, chatSessionId: sessionId, startedAt: AT }),
  ]);
}

describe("changes after launch", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("a change gets its own conversation", async () => {
    h = await liveStudio();
    await startChange(h, "change-2", "session-2");
    const s = await h.state();
    const [first, second] = s.changes;
    expect(second).toMatchObject({ id: "change-2", kind: "CHANGE", chatSessionId: "session-2" });
    expect(second.chatSessionIds).toEqual(["session-2"]);
    expect(first.chatSessionIds).not.toContain("session-2");
    expect(s.activeChangeId).toBe("change-2");
  });

  it("discard resets the code to the live version and keeps the story", async () => {
    h = await liveStudio();
    await startChange(h, "change-2", "session-2");
    const memory = newRequestsMemory();
    // The new change already starts from the live code: nothing to put back.
    expect(await requestsPass(h.octx, memory)).toBeNull();
    await dispatchProduct(h.ctx, [
      a.planSteps({ changeId: "change-2", steps: [{ kind: "DATA", total: null }, { kind: "LIVE", total: null }] }),
      a.addMilestone({ changeId: "change-2", id: "m-1", text: "Added a notes field", at: AT }),
    ]);
    // The change's draft: an edit, a new file; the specs move on too.
    write(h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    write(h.workdir, "todo/src/notes.ts", "export const notes = true;\n");
    write(h.workdir, "specs/product/idea.md", "# Idea, with notes\n");
    expect(await draftMatches(h.workdir, "v1")).toBe(false);

    await dispatchProduct(h.ctx, [a.requestDiscard({ changeId: "change-2", requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(h.octx, memory)).toBe("discard");

    expect(read(h.workdir, "todo/src/model.ts")).toBe("export const v = 1;\n");
    expect(read(h.workdir, "todo/src/notes.ts")).toBeNull();
    expect(read(h.workdir, "specs/product/idea.md")).toBe("# Idea, with notes\n");
    expect(await draftMatches(h.workdir, "v1")).toBe(true);
    const s = await h.state();
    const change = s.changes.find((c) => c.id === "change-2")!;
    expect(change.status).toBe("DISCARDED");
    expect(change.request).toBe("request for change-2");
    expect(change.chatSessionId).toBe("session-2");
    expect(change.milestones.map((m) => m.text)).toEqual(["Added a notes field"]);
    expect(s.activeChangeId).toBeNull();
    expect(s.pendingRequest).toBeNull();
    expect(s.liveVersion).toBe(1);
  });

  it("a new change starts from the live version's code, once", async () => {
    h = await liveStudio();
    // Code left over after the launch (never part of a version).
    write(h.workdir, "todo/src/model.ts", "export const v = 99;\n");
    write(h.workdir, "todo/src/leftover.ts", "x\n");
    await startChange(h, "change-2", "session-2", "UNDO");
    const memory = newRequestsMemory();

    expect(await requestsPass(h.octx, memory)).toBe("change-base");
    expect(read(h.workdir, "todo/src/model.ts")).toBe("export const v = 1;\n");
    expect(read(h.workdir, "todo/src/leftover.ts")).toBeNull();
    expect(read(h.workdir, "specs/product/idea.md")).toBe("# Idea\n");

    // Checked once per change: later edits (before the plan) aren't touched again.
    write(h.workdir, "todo/src/model.ts", "export const v = 3;\n");
    expect(await requestsPass(h.octx, memory)).toBeNull();
    expect(read(h.workdir, "todo/src/model.ts")).toBe("export const v = 3;\n");
  });

  it("never resets the code of a change the agent has planned", async () => {
    h = await liveStudio();
    await startChange(h, "change-2", "session-2");
    await dispatchProduct(h.ctx, [
      a.planSteps({ changeId: "change-2", steps: [{ kind: "PLAN", total: null }] }),
    ]);
    write(h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    const s = await h.state();
    const change = s.changes.find((c) => c.id === "change-2")!;
    expect(awaitsBase(change)).toBe(false);
    expect(await prepareChangeBase(h.octx, change, { state: s })).toBe("skipped");
    expect(await requestsPass(h.octx, newRequestsMemory())).toBeNull();
    expect(read(h.workdir, "todo/src/model.ts")).toBe("export const v = 2;\n");
  });

  it("leaves the first build alone and needs something live", async () => {
    h = await launchHarness({ snapshot, discardDraft });
    write(h.workdir, "todo/powerhouse.config.json", "{}\n");
    const s = await h.state();
    // FIRST_BUILD, nothing live.
    expect(await prepareChangeBase(h.octx, s.changes[0])).toBe("skipped");
    expect(liveTag(s)).toBeNull();
    // A CHANGE while nothing is live: no live code to start from.
    const change = { ...s.changes[0], kind: "CHANGE" as const };
    expect(await prepareChangeBase(h.octx, change, { state: s })).toBe("skipped");
    expect(read(h.workdir, "todo/powerhouse.config.json")).toBe("{}\n");
  });

  it("reads the live tag from the version, falling back to v<n>", () => {
    const base = { liveVersion: 2, versions: [{ number: 2, gitTag: "v2-retag" }] };
    expect(liveTag(base as never)).toBe("v2-retag");
    expect(liveTag({ liveVersion: 3, versions: [] } as never)).toBe("v3");
  });
});

describe("draftMatches", () => {
  let root: string;
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("compares only the reactor projects with the tag", async () => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "draft-matches-"));
    expect(await draftMatches(root, "v1")).toBe(false); // no repository yet
    write(root, "todo/powerhouse.config.json", "{}\n");
    write(root, "todo/src/a.ts", "a\n");
    await snapshot(root, 1, "First");
    expect(await draftMatches(root, "v1")).toBe(true);
    expect(await draftMatches(root, "v9")).toBe(false); // no such tag

    write(root, "specs/idea.md", "spec\n");
    write(root, ".ph/chat.db", "chat\n");
    expect(await draftMatches(root, "v1")).toBe(true);

    write(root, "todo/src/b.ts", "b\n");
    expect(await draftMatches(root, "v1")).toBe(false);
    fs.rmSync(path.join(root, "todo/src/b.ts"));
    fs.rmSync(path.join(root, "todo/src/a.ts"));
    expect(await draftMatches(root, "v1")).toBe(false);
    git(root, "checkout", "-q", "--", "todo/src/a.ts");
    expect(await draftMatches(root, "v1")).toBe(true);
    write(root, "second/powerhouse.config.json", "{}\n");
    expect(await draftMatches(root, "v1")).toBe(false);
  });
});
