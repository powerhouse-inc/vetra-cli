import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAKE_ADDITIVE_MESSAGE,
  agentMessage,
  breakingReason,
  checkLaunchCompat,
  compareModels,
  messageAgent,
  readModelSpecs,
  readWorkingModelSpecs,
  toModelSpec,
  type ModelSpec,
} from "../../src/launch/compat-launch.js";
import { LAUNCH_TRIGGER, launch } from "../../src/launch/orchestrator.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { a, AT, launchHarness, makeReady, type LaunchHarness } from "./orchestrator-helpers.js";

const STATE = `
type TodoState {
  title: String
  items: [Item!]!
}
type Item {
  id: OID!
  text: String!
  status: Status!
}
enum Status { OPEN DONE }
`;

const ADD_ITEM = `
input AddItemInput {
  id: OID!
  text: String!
}
`;

function todo(over: Partial<ModelSpec> = {}): ModelSpec {
  return {
    documentType: "acme/todo",
    stateSchema: STATE,
    operations: [
      { name: "ADD_ITEM", inputSchema: ADD_ITEM },
      { name: "CLEAR", inputSchema: "input ClearInput { _: Boolean }" },
    ],
    ...over,
  };
}

function whats(live: ModelSpec[], next: ModelSpec[]): string[] {
  return compareModels(live, next).breaking.map((b) => b.what);
}

describe("compareModels (D6)", () => {
  it("new optional field launches", () => {
    const next = todo({ stateSchema: STATE.replace("title: String", "title: String\n  dueDate: DateTime") });
    expect(whats([todo()], [next])).toEqual([]);
  });

  it("new operation launches", () => {
    const next = todo({
      operations: [...todo().operations, { name: "RENAME", inputSchema: "input RenameInput { title: String! }" }],
    });
    expect(whats([todo()], [next])).toEqual([]);
  });

  it("new model, new type and new enum value launch", () => {
    const next = todo({
      stateSchema: `${STATE.replace("enum Status { OPEN DONE }", "enum Status { OPEN DONE ARCHIVED }")}\ntype Tag { id: OID! }`,
    });
    const other: ModelSpec = { documentType: "acme/note", stateSchema: "type NoteState { text: String! }", operations: [] };
    expect(whats([todo()], [next, other])).toEqual([]);
  });

  it("removed field blocks with a plain reason", () => {
    const next = todo({ stateSchema: STATE.replace("  title: String\n", "") });
    const { breaking } = compareModels([todo()], [next]);
    expect(breaking).toEqual([{ model: "acme/todo", what: 'field "TodoState.title" was removed' }]);
    expect(breakingReason(breaking)).toBe(
      'This change would break data your users already have: field "TodoState.title" was removed.',
    );
  });

  it("new required field blocks", () => {
    const next = todo({ stateSchema: STATE.replace("  text: String!\n", "  text: String!\n  priority: Int!\n") });
    expect(whats([todo()], [next])).toEqual(['field "Item.priority" is new and required']);
  });

  it("changed field type blocks", () => {
    const next = todo({ stateSchema: STATE.replace("  text: String!\n", "  text: Int!\n") });
    expect(whats([todo()], [next])).toEqual(['field "Item.text" changed type from String! to Int!']);
  });

  it("an optional field made required blocks", () => {
    const next = todo({ stateSchema: STATE.replace("title: String\n", "title: String!\n") });
    expect(whats([todo()], [next])).toEqual(['field "TodoState.title" is now required']);
  });

  it("a removed enum value or type blocks", () => {
    const next = todo({
      stateSchema: STATE.replace("enum Status { OPEN DONE }", "enum Status { OPEN }"),
    });
    expect(whats([todo()], [next])).toEqual(['"DONE" was removed from "Status"']);
    const noItems = todo({ stateSchema: "type TodoState { title: String }" });
    expect(whats([todo()], [noItems])).toEqual(
      expect.arrayContaining(['"Item" was removed', '"Status" was removed', 'field "TodoState.items" was removed']),
    );
  });

  it("removed or renamed operations block", () => {
    const next = todo({ operations: [{ name: "ADD_TODO_ITEM", inputSchema: ADD_ITEM }] });
    expect(whats([todo()], [next])).toEqual([
      'operation "ADD_ITEM" was removed',
      'operation "CLEAR" was removed',
    ]);
  });

  it("an operation input that gains a required field or changes a type blocks", () => {
    const required = todo({
      operations: [{ name: "ADD_ITEM", inputSchema: ADD_ITEM.replace("text: String!", "text: String!\n  due: DateTime!") }, todo().operations[1]],
    });
    expect(whats([todo()], [required])).toEqual(['operation "ADD_ITEM": field "AddItemInput.due" is new and required']);
    const optional = todo({
      operations: [{ name: "ADD_ITEM", inputSchema: ADD_ITEM.replace("text: String!", "text: String!\n  due: DateTime") }, todo().operations[1]],
    });
    expect(whats([todo()], [optional])).toEqual([]);
    const changed = todo({
      operations: [{ name: "ADD_ITEM", inputSchema: ADD_ITEM.replace("text: String!", "text: Int!") }, todo().operations[1]],
    });
    expect(whats([todo()], [changed])).toEqual([
      'operation "ADD_ITEM": field "AddItemInput.text" changed type from String! to Int!',
    ]);
  });

  it("an input that uses a state enum compares it as a name", () => {
    const op = { name: "SET_STATUS", inputSchema: "input SetStatusInput { id: OID! status: Status! }" };
    expect(whats([todo({ operations: [op] })], [todo({ operations: [op] })])).toEqual([]);
  });

  it("a removed model blocks", () => {
    expect(whats([todo()], [])).toEqual(['"acme/todo" was removed']);
  });

  it("a next description that doesn't read blocks; a live one that doesn't read is not compared", () => {
    expect(whats([todo()], [todo({ stateSchema: "type TodoState {" })])).toEqual(["its description can't be read"]);
    expect(whats([todo({ stateSchema: "type TodoState {" })], [todo()])).toEqual([]);
  });

  it("an emptied state description removes its types", () => {
    expect(whats([todo()], [todo({ stateSchema: "" })])).toEqual(
      expect.arrayContaining(['"TodoState" was removed']),
    );
    expect(whats([todo({ stateSchema: "" })], [todo()])).toEqual([]);
  });

  it("the plain reason names three breaks and counts the rest", () => {
    const breaking = ["a", "b", "c", "d", "e"].map((w) => ({ model: "acme/todo", what: w }));
    expect(breakingReason(breaking)).toBe(
      "This change would break data your users already have: a; b; c; and 2 more.",
    );
  });

  it("the agent is told to make the change additive, with what would break", () => {
    const text = agentMessage([{ model: "acme/todo", what: 'field "TodoState.title" was removed' }]);
    expect(text.split("\n")[0]).toBe(
      "Make this change additive: keep existing fields and operations, add new ones as optional.",
    );
    expect(text).toContain('- acme/todo: field "TodoState.title" was removed');
  });
});

/* ------------------------------------------------------------------------ */

function modelJson(spec: { id: string; state: string; local?: string; ops: Array<[string, string | null]> }): string {
  return JSON.stringify({
    id: spec.id,
    name: "Todo",
    specifications: [
      {
        version: 1,
        state: { global: { schema: spec.state }, local: { schema: spec.local ?? "" } },
        modules: [{ id: "m", name: "items", operations: spec.ops.map(([name, schema]) => ({ name, schema })) }],
      },
    ],
  });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
    cwd,
    stdio: "ignore",
  });
}

describe("reading models at a version", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function repo(): Promise<string> {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "compat-"));
    git(dir, "init", "-q", "-b", "main");
    const model = path.join(dir, "todo-app", "document-models", "todo");
    await fs.mkdir(model, { recursive: true });
    await fs.writeFile(
      path.join(model, "todo.json"),
      modelJson({ id: "acme/todo", state: STATE, local: "type TodoLocalState { seen: Boolean }", ops: [["ADD_ITEM", ADD_ITEM], ["CLEAR", null]] }),
    );
    // Not models: a nested node_modules copy and another JSON in the folder.
    await fs.mkdir(path.join(dir, "todo-app", "node_modules", "x", "document-models", "y"), { recursive: true });
    await fs.writeFile(path.join(dir, "todo-app", "node_modules", "x", "document-models", "y", "y.json"), "{}");
    await fs.writeFile(path.join(model, "other.json"), "{}");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "Version 1");
    git(dir, "tag", "v1");
    return dir;
  }

  it("reads every model of a tag and of the working tree, new files included", async () => {
    const wd = await repo();
    const live = await readModelSpecs(wd, "v1");
    expect(live).toEqual([
      {
        documentType: "acme/todo",
        stateSchema: `${STATE}\ntype TodoLocalState { seen: Boolean }`,
        operations: [
          { name: "ADD_ITEM", inputSchema: ADD_ITEM },
          { name: "CLEAR", inputSchema: "" },
        ],
      },
    ]);
    const note = path.join(wd, "todo-app", "document-models", "note");
    await fs.mkdir(note, { recursive: true });
    await fs.writeFile(note + "/note.json", modelJson({ id: "acme/note", state: "type NoteState { t: String }", ops: [] }));
    const next = await readWorkingModelSpecs(wd);
    expect(next.map((m) => m.documentType).sort()).toEqual(["acme/note", "acme/todo"]);
    expect(await checkLaunchCompat(wd, "v1")).toEqual({ breaking: [] });
  });

  it("a removed field in the working tree is found against the tag", async () => {
    const wd = await repo();
    await fs.writeFile(
      path.join(wd, "todo-app", "document-models", "todo", "todo.json"),
      modelJson({ id: "acme/todo", state: STATE.replace("  title: String\n", ""), local: "type TodoLocalState { seen: Boolean }", ops: [["ADD_ITEM", ADD_ITEM], ["CLEAR", null]] }),
    );
    expect(await checkLaunchCompat(wd, "v1")).toEqual({
      breaking: [{ model: "acme/todo", what: 'field "TodoState.title" was removed' }],
    });
  });

  it("the latest specification counts; files that aren't models are skipped", () => {
    const two = JSON.stringify({
      id: "acme/todo",
      specifications: [
        { version: 2, state: { global: { schema: "type B { b: Int }" } }, modules: [] },
        { version: 1, state: { global: { schema: "type A { a: Int }" } }, modules: [] },
      ],
    });
    expect(toModelSpec(two)?.stateSchema).toBe("type B { b: Int }");
    expect(toModelSpec("not json")).toBeNull();
    expect(toModelSpec("{}")).toBeNull();
    expect(toModelSpec(JSON.stringify({ id: "x", specifications: [] }))).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */

describe("the gate in a launch", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  async function liveThenChange(breaking: { model: string; what: string }[], chatSessionId: string | null = "chat-2") {
    const checked: string[] = [];
    h = await launchHarness({
      checkCompat: async (_wd, tag) => {
        checked.push(tag);
        return { breaking };
      },
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await dispatchProduct(h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "drop the title", startedAt: AT, ...(chatSessionId ? { chatSessionId } : {}) }),
    ]);
    await makeReady(h, "change-2");
    h.calls.length = 0;
    return checked;
  }

  it("the first launch is not checked; a later one is checked against the live tag", async () => {
    const checked = await liveThenChange([]);
    expect(checked).toEqual([]);
    const out = await launch(h!.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    expect(out).toEqual({ status: "LIVE", number: 2 });
    expect(checked).toEqual(["v1"]);
  });

  it("a breaking change stops before anything runs, records the plain reason and tells the agent", async () => {
    await liveThenChange([{ model: "acme/todo", what: 'field "TodoState.title" was removed' }]);

    const out = await launch(h!.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });

    const reason = 'This change would break data your users already have: field "TodoState.title" was removed.';
    expect(out).toEqual({ status: "FAILED", number: 2, reason });
    expect(h!.calls).toEqual([`message chat-2 ${MAKE_ADDITIVE_MESSAGE}`]);
    const s = await h!.state();
    expect(s.liveVersion).toBe(1);
    const v2 = s.versions.find((v) => v.number === 2)!;
    expect(v2.status).toBe("FAILED");
    expect(v2.failure).toBe(reason);
    expect(v2.lines.every((l) => l.status === "WAITING")).toBe(true);
    const change = s.changes.find((c) => c.id === "change-2")!;
    expect(change.status).toBe("READY");
    expect(change.steps.find((st) => st.kind === "LIVE")).toMatchObject({ status: "STOPPED", reason });
  });

  it("without a conversation, or when the message can't go out, the launch is still stopped", async () => {
    await liveThenChange([{ model: "acme/todo", what: "x" }], null);
    const out = await launch(h!.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    expect(out.status).toBe("FAILED");
    expect(h!.calls).toEqual([]);
    expect(h!.lines.some((l) => l.includes("no conversation"))).toBe(true);
    await h!.cleanup();

    h = await launchHarness({
      checkCompat: async () => ({ breaking: [{ model: "acme/todo", what: "x" }] }),
      messageAgent: async () => {
        throw new Error("reactor down");
      },
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await dispatchProduct(h.ctx, [a.startChange({ id: "change-2", kind: "CHANGE", request: "r", chatSessionId: "chat-2", startedAt: AT })]);
    await makeReady(h, "change-2");
    const again = await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    expect(again.status).toBe("FAILED");
    expect(h.lines.some((l) => l.includes("couldn't be told: reactor down"))).toBe(true);
  });

  it("a check that can't run lets the launch go on and is logged", async () => {
    h = await launchHarness({
      checkCompat: async () => {
        throw new Error("not a git repository");
      },
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await dispatchProduct(h.ctx, [a.startChange({ id: "change-2", kind: "CHANGE", request: "r", startedAt: AT })]);
    await makeReady(h, "change-2");
    const out = await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    expect(out).toEqual({ status: "LIVE", number: 2 });
    expect(h.lines.some((l) => l.includes("data compatibility not checked: not a git repository"))).toBe(true);
  });
});

describe("messageAgent", () => {
  it("writes a user message into the change's conversation", async () => {
    const sent: Array<{ id: string; branch: string; actions: unknown[] }> = [];
    const ctx = {
      folders: {},
      reactor: async () => ({
        personalDriveId: "vetra",
        client: {
          execute: async (id: string, branch: string, actions: unknown[]) => {
            sent.push({ id, branch, actions });
          },
        },
      }),
    };
    await messageAgent(ctx, "chat-2", "hello", AT);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: "chat-2", branch: "main" });
    expect(sent[0].actions[0]).toMatchObject({
      type: "ADD_USER_MESSAGE",
      input: { createdAt: AT, content: [{ type: "TEXT", text: "hello" }] },
    });
    await expect(messageAgent({}, "chat-2", "hello", AT)).rejects.toThrow("no reactor");
  });
});
