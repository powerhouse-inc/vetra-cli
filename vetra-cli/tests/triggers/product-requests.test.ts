import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import { seedCheck } from "../../src/launch/seed.js";
import { DEPLOY_FAILED_REASON } from "../../src/launch/verify.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import {
  newRequestsMemory,
  productRequestsTrigger,
  requestsPass,
} from "../../src/triggers/product-requests.js";
import { AT, a, launchHarness, makeReady, readyChange, type LaunchHarness } from "../launch/orchestrator-helpers.js";

const BY = "did:pkh:eip155:1:0xowner";

const ALL_PASS = [
  { kind: "GENERATE" as const, passed: true },
  { kind: "TYPECHECK" as const, passed: true },
  { kind: "LINT" as const, passed: true },
  { kind: "REDUCER_TESTS" as const, passed: true },
  { kind: "SMOKE" as const, passed: true },
];

const TODO_MODEL = {
  id: "acme/todo-list",
  name: "TodoList",
  extension: ".todo",
  description: "",
  author: { name: "", website: "" },
  specifications: [
    {
      version: 1,
      changeLog: [],
      state: {
        global: {
          schema: "type TodoListState {\n  todos: [Todo!]!\n}\n\ntype Todo {\n  id: OID!\n  title: String!\n}",
          initialValue: '{"todos":[]}',
          examples: [],
        },
        local: { schema: "", initialValue: "", examples: [] },
      },
      modules: [
        {
          id: "m1",
          name: "todos",
          description: "",
          operations: [
            {
              id: "o1",
              name: "ADD_TODO",
              scope: "global",
              schema: "input AddTodoInput {\n  id: OID!\n  title: String!\n}",
              description: "",
              template: "",
              reducer: "",
              errors: [],
              examples: [],
            },
          ],
        },
      ],
    },
  ],
};

async function write(root: string, rel: string, value: unknown): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

/** Plan PLAN → TESTS → LIVE and finish PLAN: the change waits on the TESTS gate. */
async function planWithTests(h: LaunchHarness): Promise<void> {
  await dispatchProduct(h.ctx, [
    a.planSteps({
      changeId: "change-1",
      steps: [
        { kind: "PLAN", total: null },
        { kind: "TESTS", total: null },
        { kind: "LIVE", total: null },
      ],
    }),
    a.completeStep({ changeId: "change-1", kind: "PLAN", at: AT }),
  ]);
}

async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("product-requests trigger", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("auto-launch waits for a passing TESTS gate in the same change", async () => {
    h = await launchHarness();
    const memory = newRequestsMemory();
    await planWithTests(h);

    expect(await requestsPass(h.octx, memory)).toBeNull();
    expect((await h.state()).versions).toEqual([]);

    await dispatchProduct(h.ctx, [
      a.recordCheckRun({ changeId: "change-1", id: "run-1", at: AT, results: ALL_PASS }),
      a.completeStep({ changeId: "change-1", kind: "TESTS", at: AT }),
    ]);
    expect((await h.state()).changes[0].status).toBe("READY");

    expect(await requestsPass(h.octx, memory)).toBe("auto-launch");
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions[0].launchedBy).toBe("vetra");
  });

  it("seed documents that fail validation block the first launch", async () => {
    h = await launchHarness();
    const project = path.join(h.workdir, "todo-app");
    await write(project, "document-models/todo-list/todo-list.json", TODO_MODEL);
    await write(project, "seed/todo-list.json", {
      documentType: "acme/todo-list",
      documents: [{ name: "Example — delete me: Groceries", actions: [{ type: "ADD_TODO", input: { id: "t1" } }] }],
    });
    const { check } = seedCheck(project, { requireExamples: true });
    expect(check?.passed).toBe(false);
    await planWithTests(h);
    await dispatchProduct(h.ctx, [
      a.recordCheckRun({
        changeId: "change-1",
        id: "run-1",
        at: AT,
        results: [...ALL_PASS.filter((r) => r.kind !== "SMOKE"), { kind: "SMOKE", passed: false, reason: check!.reason }],
      }),
    ]);
    await expect(dispatchProduct(h.ctx, [a.completeStep({ changeId: "change-1", kind: "TESTS", at: AT })])).rejects.toThrow(
      "the latest SMOKE did not pass",
    );

    expect(await requestsPass(h.octx, newRequestsMemory())).toBeNull();
    expect((await h.state()).versions).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("the automatic launch fires for any kind of change while nothing is live (F6)", async () => {
    for (const kind of ["CHANGE", "UNDO"] as const) {
      h = await launchHarness({}, { kind });
      await makeReady(h);
      expect(await requestsPass(h.octx, newRequestsMemory())).toBe("auto-launch");
      expect((await h.state()).liveVersion).toBe(1);
      await h.cleanup();
      h = undefined;
    }
  });

  it("after a failed automatic launch only Try again launches (F10)", async () => {
    let fail = true;
    h = await launchHarness({
      waitForDeployment: async () => (fail ? { failed: DEPLOY_FAILED_REASON } : "READY"),
    });
    await makeReady(h);
    expect(await requestsPass(h.octx, newRequestsMemory())).toBe("auto-launch");
    expect((await h.state()).versions[0].status).toBe("FAILED");
    expect((await h.state()).changes[0].status).toBe("READY");
    fail = false;
    h.calls.length = 0;

    // A restart (fresh memory) does not launch the failed change again.
    const memory = newRequestsMemory();
    expect(await requestsPass(h.octx, memory)).toBeNull();
    expect(h.calls).toEqual([]);

    await dispatchProduct(h.ctx, [a.requestLaunch({ changeId: "change-1", requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(h.octx, memory)).toBe("launch");
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].launchedBy).toBe(BY);
    expect(s.pendingRequest).toBeNull();
  });

  it("a later change is not launched by itself once something is live (D3)", async () => {
    h = await launchHarness();
    await makeReady(h);
    await requestsPass(h.octx, newRequestsMemory());
    await readyChange(h, "change-2");
    h.calls.length = 0;
    expect(await requestsPass(h.octx, newRequestsMemory())).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("a launch interrupted by a restart resumes and completes", async () => {
    h = await launchHarness();
    await makeReady(h, "change-1", { title: "Team todo list" });
    await dispatchProduct(h.ctx, [
      a.setLiveTarget({ appId: "app-1", productionEnvironmentId: "env-prod-1", slug: "team-todo", liveUrl: "https://team-todo.vetra.io" }),
      a.startLaunch({ number: 1, changeId: "change-1", at: AT }),
      a.setLaunchLine({ number: 1, kind: "SNAPSHOT", status: "DONE", detail: "sha-before" }),
      a.setLaunchLine({ number: 1, kind: "PUBLISH", status: "DONE", detail: "@vetra-apps/team-todo@1.0.7" }),
      a.setLaunchLine({ number: 1, kind: "DEPLOY", status: "RUNNING", detail: "dep-before" }),
    ]);

    expect(await requestsPass(h.octx, newRequestsMemory())).toBe("resume");

    expect(h.calls).toEqual([
      "wait dep-before",
      'drive app-1 https://team-todo-switchboard.vetra.io "Team Todo"',
      "setDrive app-1 drive-1",
      "check https://team-todo.vetra.io",
    ]);
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions[0]).toMatchObject({
      sha: "sha-before",
      deploymentId: "dep-before",
      packages: [{ name: "@vetra-apps/team-todo", version: "1.0.7" }],
    });
  });

  it("resumes a LAUNCHING version on any pass, not only the first after a start", async () => {
    h = await launchHarness();
    await makeReady(h);
    await requestsPass(h.octx, newRequestsMemory()); // Version 1 live
    await readyChange(h, "change-2");
    const memory = newRequestsMemory();
    expect(await requestsPass(h.octx, memory)).toBeNull();

    await dispatchProduct(h.ctx, [a.startLaunch({ number: 2, changeId: "change-2", at: AT })]);
    expect((await h.state()).versions[1].status).toBe("LAUNCHING");

    expect(await requestsPass(h.octx, memory)).toBe("resume");
    expect((await h.state()).liveVersion).toBe(2);
  });

  it("a LAUNCH request that can no longer start is cleared with a plain reason (X28)", async () => {
    h = await launchHarness();
    await makeReady(h);
    await dispatchProduct(h.ctx, [a.requestLaunch({ changeId: "change-1", requestedAt: AT, requestedBy: BY })]);
    // The agent reopens a step before the pass runs: the change isn't READY.
    await dispatchProduct(h.ctx, [a.reopenStep({ changeId: "change-1", kind: "PLAN", reason: "one more fix", at: AT })]);

    expect(await requestsPass(h.octx, newRequestsMemory())).toBe("launch");

    const s = await h.state();
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toEqual({
      kind: "LAUNCH",
      reason: "your product isn't ready to go live yet",
      at: AT,
    });
    expect(s.versions).toHaveLength(0);
  });

  it("a LAUNCH request written while no client is subscribed completes", async () => {
    h = await launchHarness({ checkLive: async () => false });
    await makeReady(h);
    const memory = newRequestsMemory();
    await requestsPass(h.octx, memory); // the automatic launch fails at VERIFY
    expect((await h.state()).versions[0].status).toBe("FAILED");
    h.deps.checkLive = async () => true;

    // Only the reactor: the request is an operation on the product document.
    await h.module.client.execute(h.productId!, "main", [
      a.requestLaunch({ changeId: "change-1", requestedAt: AT, requestedBy: BY }),
    ]);
    const tstate = productRequestsTrigger.state!();
    const tctx = {
      state: tstate,
      commandContext: h.octx,
      context: { log: h.octx.log },
      reactor: h.octx.reactor,
      agent: async () => undefined,
    } as unknown as Parameters<typeof productRequestsTrigger.poll>[0];

    expect(await productRequestsTrigger.poll(tctx)).toBeNull(); // returns at once
    await until(async () => (await h!.state()).liveVersion === 1);
    await until(async () => tstate.running === false);
    const s = await h.state();
    expect(s.pendingRequest).toBeNull();
    expect(s.versions[0].status).toBe("LIVE");
  });

  it("MIRROR is cleared until GitHub arrives; Restart and Go back are served", async () => {
    h = await launchHarness();
    await makeReady(h);
    const memory = newRequestsMemory();
    await requestsPass(h.octx, memory);
    h.calls.length = 0;

    await dispatchProduct(h.ctx, [a.requestMirror({ requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(h.octx, memory)).toBe("mirror");
    expect((await h.state()).pendingRequest).toBeNull();

    await dispatchProduct(h.ctx, [a.requestRestart({ requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(h.octx, memory)).toBe("restart");
    expect(h.calls).toEqual(["rollback dep-1", "wait dep-1-again"]);
    expect((await h.state()).pendingRequest).toBeNull();
  });

  it("a confirmed Discard puts the code back on the live version", async () => {
    h = await launchHarness();
    await makeReady(h);
    const memory = newRequestsMemory();
    await requestsPass(h.octx, memory);
    await readyChange(h, "change-2");
    h.calls.length = 0;

    await dispatchProduct(h.ctx, [a.requestDiscard({ changeId: "change-2", requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(h.octx, memory)).toBe("discard");
    expect(h.calls).toEqual(["discard v1"]);
    expect((await h.state()).pendingRequest).toBeNull();
  });

  it("does nothing outside a Studio", async () => {
    h = await launchHarness();
    await makeReady(h);
    const tstate = productRequestsTrigger.state!();
    const tctx = {
      state: tstate,
      commandContext: { ...h.octx, config: {} },
      context: { log: h.octx.log },
    } as unknown as Parameters<typeof productRequestsTrigger.poll>[0];
    await productRequestsTrigger.poll(tctx);
    expect(tstate.running).toBe(false);
    expect((await h.state()).versions).toEqual([]);
  });
});
