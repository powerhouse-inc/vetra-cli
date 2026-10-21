import { afterEach, describe, expect, it } from "@jest/globals";
import type { Action } from "document-model";
import { withSignaturePolicy } from "document-model";
import { ReactorBuilder, ReactorClientBuilder, type ReactorClientModule } from "@powerhousedao/reactor";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { ChatSession } from "@powerhousedao/clint-common/document-models/chat-session";
import type {
  ChatSessionState,
  ContentPart,
  Message,
} from "@powerhousedao/clint-common/document-models/chat-session";
import { StudioProductV1 } from "vetra-app/document-models";
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import {
  BREATHER_REASON,
  CONTINUE_TEXT,
  evaluate,
  type SupervisorAction,
} from "../../src/product/supervisor-rules.js";
import { supervise } from "../../src/product/supervisor.js";
import type { ProductContext } from "../../src/product/product-doc.js";

const a = StudioProductV1.actions;
const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const MIN = 60;

/* ---------- product fixtures (built with the real reducer) ---------- */

function product(...actions: Action[]): StudioProductState {
  let doc = StudioProductV1.utils.createDocument();
  for (const action of [
    a.initProduct({ name: "Todo", idea: "a todo app", createdAt: at(0) }),
    a.startChange({ id: "c1", kind: "FIRST_BUILD", request: "build it", chatSessionId: "chat-1", startedAt: at(0) }),
    a.planSteps({ changeId: "c1", steps: [{ kind: "PLAN" }, { kind: "DATA" }, { kind: "EDITORS" }, { kind: "TESTS" }, { kind: "LIVE" }] }),
    a.startStep({ changeId: "c1", kind: "PLAN", label: "the plan", at: at(0) }),
    ...actions,
  ]) {
    doc = StudioProductV1.reducer(doc, action);
    const ops = Object.values(doc.operations).flat();
    const error = ops[ops.length - 1]?.error;
    if (error) throw new Error(`fixture action refused: ${error}`);
  }
  return doc.state.global;
}

const milestone = (id: string, sec: number) =>
  a.addMilestone({ changeId: "c1", id, text: "Saved the plan", at: at(sec) });
const checkRun = (id: string, sec: number, kind: "GENERATE" | "TYPECHECK" | "SMOKE", passed: boolean, reason?: string) =>
  a.recordCheckRun({ changeId: "c1", id, at: at(sec), results: [{ kind, passed, reason: reason ?? null }] });

/* ---------- chat fixtures ---------- */

let n = 0;
const id = () => `m${++n}`;
const part = (p: Partial<ContentPart> & Pick<ContentPart, "type">): ContentPart => ({
  args: null, attachment: null, error: null, filename: null, id: id(), isError: null,
  mediaType: null, result: null, text: null, toolCallId: null, toolName: null, url: null, ...p,
});
const msg = (m: Partial<Message> & Pick<Message, "role">): Message => ({
  content: [], createdAt: at(0), failure: null, finishReason: null, finishedAt: null,
  id: id(), pickedUpAt: null, stepIndex: null, usage: null, ...m,
});
const user = (text: string, sec: number, pickedUp = true) =>
  msg({ role: "USER", createdAt: at(sec), pickedUpAt: pickedUp ? at(sec) : null, content: [part({ type: "TEXT", text })] });
const toolCall = (tool: string, callId: string, sec: number) =>
  msg({ role: "ASSISTANT", createdAt: at(sec), content: [part({ type: "TOOL_CALL", toolName: tool, toolCallId: callId })] });
const toolResult = (tool: string, callId: string, sec: number) =>
  msg({ role: "TOOL", createdAt: at(sec), content: [part({ type: "TOOL_RESULT", toolName: tool, toolCallId: callId, result: "ok" })] });
const reply = (sec: number, finishReason: string | null) =>
  msg({ role: "ASSISTANT", createdAt: at(sec), finishReason, finishedAt: finishReason ? at(sec) : null, content: [part({ type: "TEXT", text: "…" })] });

function chat(...messages: Message[]): ChatSessionState {
  return {
    agent: null, endedAt: null, interruptRequested: false, messages, resourceId: null,
    retryRequestedAt: null, retryRequestedFor: null, startedAt: at(0), status: "ACTIVE",
    threadId: "t1", usage: null,
  };
}

const of = <T extends SupervisorAction["type"]>(actions: SupervisorAction[], type: T) =>
  actions.filter((x): x is Extract<SupervisorAction, { type: T }> => x.type === type);
const run = (state: StudioProductState, c: ChatSessionState | null, sec: number, previewReady?: boolean) =>
  evaluate(state, c, new Date(T0 + sec * 1000), { chatSessionId: "chat-1", previewReady });

describe("supervisor rules: stuck", () => {
  it("marks a running turn stuck after 5 min without a milestone", () => {
    const c = chat(user("build it", 0), toolCall("spec-get", "x1", 10), toolResult("spec-get", "x1", 11));
    expect(of(run(product(), c, 4 * MIN + 59), "markStuck")).toEqual([]);
    const [stuck] = of(run(product(), c, 5 * MIN), "markStuck");
    expect(stuck).toMatchObject({ changeId: "c1", reason: "I'm stuck on the plan: nothing has moved for 5 minutes." });
  });

  it("does not mark stuck while a tool is still running", () => {
    const c = chat(user("build it", 0), toolCall("agent-agentEditor", "x1", 10));
    expect(of(run(product(), c, 30 * MIN), "markStuck")).toEqual([]);
  });

  it("does not mark stuck when the turn is not running", () => {
    expect(of(run(product(), chat(user("build it", 0), reply(5, "stop")), 30 * MIN), "markStuck")).toEqual([]);
    expect(of(run(product(), chat(user("build it", 0, false)), 30 * MIN), "markStuck")).toEqual([]);
    const interrupted = { ...chat(user("build it", 0), toolCall("spec-get", "x1", 1), toolResult("spec-get", "x1", 2)), interruptRequested: true };
    expect(of(run(product(), interrupted, 30 * MIN), "markStuck")).toEqual([]);
  });

  it("counts from the latest milestone, finished step or turn start", () => {
    const c = chat(user("build it", 0), toolCall("spec-get", "x1", 1), toolResult("spec-get", "x1", 2));
    expect(of(run(product(milestone("ms1", 3 * MIN)), c, 7 * MIN), "markStuck")).toEqual([]);
    expect(of(run(product(milestone("ms1", 3 * MIN)), c, 8 * MIN), "markStuck")).toHaveLength(1);
    const later = chat(user("build it", 0), reply(1, "stop"), user("go on", 6 * MIN), toolCall("spec-get", "x2", 6 * MIN + 1), toolResult("spec-get", "x2", 6 * MIN + 2));
    expect(of(run(product(), later, 10 * MIN), "markStuck")).toEqual([]);
    expect(of(run(product(), later, 11 * MIN), "markStuck")).toHaveLength(1);
  });

  it("marks stuck when the same check fails 3 runs in a row, with what was tried", () => {
    const s = product(
      checkRun("r1", 10, "GENERATE", false, "The Order model has an error"),
      checkRun("r2", 20, "GENERATE", false, "The Order model has another error"),
      checkRun("r3", 30, "GENERATE", false),
    );
    const [stuck] = of(run(s, null, 40), "markStuck");
    expect(stuck.reason).toBe("I'm stuck: the code generation failed 3 times in a row.");
    expect(stuck.tried).toEqual([
      "Try 1: The Order model has an error",
      "Try 2: The Order model has another error",
      "Try 3: the code generation failed",
    ]);
    // A pass in between breaks the streak.
    const broken = product(
      checkRun("r1", 10, "GENERATE", false), checkRun("r2", 20, "GENERATE", true),
      checkRun("r3", 30, "GENERATE", false), checkRun("r4", 40, "GENERATE", false),
    );
    expect(of(run(broken, null, 50), "markStuck")).toEqual([]);
  });

  it("does not mark stuck again while stuck, or within 5 min of the last milestone (F38)", () => {
    const fails = [checkRun("r1", 10, "TYPECHECK", false), checkRun("r2", 20, "TYPECHECK", false), checkRun("r3", 30, "TYPECHECK", false)];
    const stuck = product(...fails, a.markStuck({ changeId: "c1", reason: "stuck", tried: [], at: at(31) }));
    expect(of(run(stuck, null, 40), "markStuck")).toEqual([]);
    // A milestone clears `stuck` in the reducer; the old streak never re-fires.
    const recovered = product(...fails, a.markStuck({ changeId: "c1", reason: "stuck", tried: [], at: at(31) }), milestone("ms1", 60));
    expect(recovered.changes[0].stuck).toBeNull();
    expect(of(run(recovered, null, 2 * MIN), "markStuck")).toEqual([]);
    expect(of(run(recovered, null, 30 * MIN), "markStuck")).toEqual([]);
    // A new streak after the milestone waits out the 5 minutes.
    const again = product(milestone("ms1", 5), checkRun("r4", 10, "SMOKE", false), checkRun("r5", 20, "SMOKE", false), checkRun("r6", 30, "SMOKE", false));
    expect(of(run(again, null, 40), "markStuck")).toEqual([]);
    expect(of(run(again, null, 5 * MIN + 5), "markStuck")).toHaveLength(1);
  });

  it("only watches a BUILDING change", () => {
    const fails = [checkRun("r1", 10, "GENERATE", false), checkRun("r2", 20, "GENERATE", false), checkRun("r3", 30, "GENERATE", false)];
    const paused = product(...fails, a.pauseChange({ changeId: "c1", at: at(35) }));
    expect(of(run(paused, null, 40), "markStuck")).toEqual([]);
  });
});

describe("supervisor rules: step cap", () => {
  it("auto-continues once, then asks", () => {
    const capped = chat(user("build it", 0), toolCall("spec-get", "x1", 1), toolResult("spec-get", "x1", 2), reply(3, "tool-calls"));
    const first = run(product(), capped, 10);
    expect(of(first, "autoContinue")).toEqual([expect.objectContaining({ changeId: "c1", chatSessionId: "chat-1" })]);
    expect(of(first, "stepAttention")).toEqual([]);

    // The continue was sent: nothing more until it is answered.
    expect(of(run(product(), chat(...capped.messages, user(CONTINUE_TEXT, 11, false)), 12), "autoContinue")).toEqual([]);

    // The continued turn hits the cap too: ask.
    const twice = chat(...capped.messages, user(CONTINUE_TEXT, 11), reply(20, "tool-calls"));
    const second = run(product(), twice, 30);
    expect(of(second, "autoContinue")).toEqual([]);
    expect(of(second, "stepAttention")).toEqual([
      expect.objectContaining({ changeId: "c1", kind: "PLAN", reason: BREATHER_REASON }),
    ]);
    // Already asked: not again.
    const asked = product(a.setStepAttention({ changeId: "c1", kind: "PLAN", status: "NEEDS_YOU", reason: BREATHER_REASON, at: at(31) }));
    expect(of(run(asked, twice, 40), "stepAttention")).toEqual([]);
  });

  it("leaves a turn that finished normally, or a change that isn't BUILDING, alone", () => {
    expect(of(run(product(), chat(user("build it", 0), reply(3, "stop")), 10), "autoContinue")).toEqual([]);
    const capped = chat(user("build it", 0), reply(3, "tool-calls"));
    const paused = product(a.pauseChange({ changeId: "c1", at: at(4) }));
    expect(of(run(paused, capped, 10), "autoContinue")).toEqual([]);
  });
});

describe("supervisor rules: preview", () => {
  const started = chat(user("build it", 0), toolCall("reactor-project-start", "p1", 100), toolResult("reactor-project-start", "p1", 101));

  it("flags Editors 60 s after the preview start when it is not up", () => {
    expect(of(run(product(), started, 159, false), "previewSlow")).toEqual([]);
    expect(of(run(product(), started, 160, false), "previewSlow")).toEqual([expect.objectContaining({ changeId: "c1" })]);
  });

  it("stays quiet when the preview is up, unknown, or a SMOKE ran since the start", () => {
    expect(of(run(product(), started, 200, true), "previewSlow")).toEqual([]);
    expect(of(run(product(), started, 200, undefined), "previewSlow")).toEqual([]);
    expect(of(run(product(checkRun("s1", 150, "SMOKE", false)), started, 200, false), "previewSlow")).toEqual([]);
    const flagged = product(a.setStepAttention({ changeId: "c1", kind: "EDITORS", status: "NEEDS_YOU", reason: "x", at: at(170) }));
    expect(of(run(flagged, started, 200, false), "previewSlow")).toEqual([]);
  });
});

describe("supervisor rules: metrics", () => {
  it("records steps, the first preview and when the change got ready", () => {
    const c = chat(user("build it", 0), toolCall("spec-get", "x1", 1), toolResult("spec-get", "x1", 2), reply(3, null));
    const s = product(checkRun("s1", 50, "SMOKE", false), checkRun("s2", 60, "SMOKE", true), checkRun("s3", 70, "SMOKE", true));
    expect(of(run(s, c, 80), "recordMetrics")).toEqual([
      expect.objectContaining({ changeId: "c1", steps: 2, firstPreviewAt: at(60), readyAt: null }),
    ]);
    // Nothing new: nothing to record.
    const recorded = product(
      checkRun("s1", 50, "SMOKE", false), checkRun("s2", 60, "SMOKE", true),
      a.recordChangeMetrics({ changeId: "c1", steps: 2, firstPreviewAt: at(60), readyAt: null }),
    );
    expect(of(run(recorded, c, 80), "recordMetrics")).toEqual([]);
  });

  it("records readyAt when every planned step is done", () => {
    const all = [
      a.recordCheckRun({
        changeId: "c1", id: "all", at: at(100),
        results: (["GENERATE", "TYPECHECK", "LINT", "REDUCER_TESTS", "SMOKE"] as const).map((kind) => ({ kind, passed: true, reason: null })),
      }),
      ...(["PLAN", "DATA", "EDITORS", "TESTS"] as const).map((kind, i) => a.completeStep({ changeId: "c1", kind, at: at(110 + i) })),
    ];
    const s = product(...all);
    expect(s.changes[0].status).toBe("READY");
    expect(of(run(s, null, 200), "recordMetrics")).toEqual([
      expect.objectContaining({ readyAt: at(113), firstPreviewAt: at(100) }),
    ]);
  });
});

/* ---------- the trigger's pass, against a real in-memory reactor ---------- */

describe("supervise", () => {
  let module: ReactorClientModule | undefined;
  afterEach(async () => {
    await module?.reactor.kill().completed;
    module = undefined;
  });

  async function setup(): Promise<{ ctx: ProductContext; productId: string; chatId: string }> {
    const builder = new ReactorBuilder().withDocumentModelSources([
      driveDocumentModelModule as never,
      StudioProductV1 as never,
      ChatSession as never,
    ]);
    module = await new ReactorClientBuilder().withReactorBuilder(builder).withCreateSignaturePolicy("legacy").buildModule();
    const client = module.client;
    const driveId = (await client.createEmpty("powerhouse/document-drive")).header.id;
    const chatDoc = await client.createDocumentInDrive(driveId, withSignaturePolicy(ChatSession.utils.createDocument(), "legacy"));
    const chatId = chatDoc.header.id;
    const productDoc = await client.createDocumentInDrive(driveId, withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy"));
    const productId = productDoc.header.id;
    await client.execute(productId, "main", [
      a.initProduct({ name: "Todo", idea: "a todo app", createdAt: at(0) }),
      a.startChange({ id: "c1", kind: "FIRST_BUILD", request: "build it", chatSessionId: chatId, startedAt: at(0) }),
      a.planSteps({ changeId: "c1", steps: [{ kind: "PLAN" }] }),
      checkRun("r1", 10, "GENERATE", false), checkRun("r2", 20, "GENERATE", false), checkRun("r3", 30, "GENERATE", false),
    ]);
    const ctx: ProductContext = {
      folders: {},
      reactor: async () => ({ client, personalDriveId: driveId, driveId }),
    };
    return { ctx, productId, chatId };
  }

  it("marks stuck, continues a capped turn and records metrics — once", async () => {
    const { ctx, productId, chatId } = await setup();
    const c = ChatSession.actions;
    await module!.client.execute(chatId, "main", [
      c.addUserMessage({ id: "u1", createdAt: at(0), content: [{ id: "p1", type: "TEXT", text: "build it" }] }),
      c.addAssistantMessage({ id: "a1", createdAt: at(1), stepIndex: 0, content: [{ id: "p2", type: "TEXT", text: "on it" }] }),
      c.finishAssistantMessage({ messageId: "a1", finishReason: "tool-calls", finishedAt: at(2) }),
    ] as Action[]);
    const done = new Set<string>();
    const now = () => new Date(T0 + 60_000);
    const carried = await supervise({ ctx, done, now });
    expect(carried.map((x) => x.type).sort()).toEqual(["autoContinue", "markStuck", "recordMetrics"]);

    const product = (await module!.client.get(productId)) as { state: { global: StudioProductState } };
    const change = product.state.global.changes[0];
    expect(change.stuck?.reason).toBe("I'm stuck: the code generation failed 3 times in a row.");
    expect(change.metrics.steps).toBe(1);
    const chatDoc = (await module!.client.get(chatId)) as { state: { global: ChatSessionState } };
    const last = chatDoc.state.global.messages.at(-1)!;
    expect(last.role).toBe("USER");
    expect(last.content[0].text).toBe(CONTINUE_TEXT);

    expect(await supervise({ ctx, done, now })).toEqual([]);
  });

  it("logs and carries on when an action fails", async () => {
    const { ctx } = await setup();
    const warnings: string[] = [];
    const broken: ProductContext = {
      ...ctx,
      reactor: async () => {
        const r = await ctx.reactor!();
        const client = r!.client as { get: (id: string) => Promise<unknown> };
        return { ...r!, client: { get: (i: string) => client.get(i), execute: () => Promise.reject(new Error("write failed")) } };
      },
    };
    const carried = await supervise({ ctx: broken, done: new Set(), now: () => new Date(T0 + 60_000), log: { warn: (m) => warnings.push(m) } });
    expect(carried).toEqual([]);
    expect(warnings.some((w) => w.includes("markStuck failed"))).toBe(true);
    // No reactor at all: nothing happens, nothing throws.
    expect(await supervise({ ctx: { folders: {}, reactor: async () => undefined }, done: new Set() })).toEqual([]);
  });
});
