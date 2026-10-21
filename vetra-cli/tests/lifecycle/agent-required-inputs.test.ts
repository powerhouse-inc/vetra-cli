/**
 * agent-required-inputs: the agent's tool schemas mark the defaulted spec
 * inputs required; the command's own schema (the CLI's) is untouched.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { commandsToMastraTools } from "@powerhousedao/ph-clint/mastra";
import { z } from "zod";
import { specCreate } from "../../src/commands/spec/create.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import {
  AGENT_REQUIRED_INPUTS,
  agentRequiredInputs,
  requireFields,
} from "../../src/lifecycle/agent-required-inputs.js";

type ToolWrap = NonNullable<
  NonNullable<Awaited<ReturnType<LifecycleHook["onInit"]>>["contribute"]>["tool"]
>;

async function wrapOf(): Promise<ToolWrap> {
  const handle = await agentRequiredInputs().onInit(
    {} as Parameters<LifecycleHook["onInit"]>[0],
  );
  const wrap = handle.contribute?.tool;
  if (!wrap) throw new Error("no tool wrap");
  return wrap;
}

/** The agent's tool for `command`, as ph-clint builds it for Mastra. */
async function agentTool(command: typeof specCreate | typeof specUpdate) {
  const tools = await commandsToMastraTools([command] as never, {
    workdir: "/tmp",
    stdout: () => {},
  } as never);
  const tool = tools[command.id];
  if (!tool) throw new Error(`no tool ${command.id}`);
  return tool;
}

function required(schema: unknown): string[] {
  const json = z.toJSONSchema(schema as z.ZodType, { io: "input" }) as {
    required?: string[];
  };
  return json.required ?? [];
}

describe("agentRequiredInputs", () => {
  it("marks spec-create's type required for the agent, not for the CLI", async () => {
    expect(required(specCreate.inputSchema)).not.toContain("type");
    const wrap = await wrapOf();
    const tool = await agentTool(specCreate);
    expect(required(tool.inputSchema)).not.toContain("type");
    const wrapped = wrap("spec-create", tool);
    expect(required(wrapped.inputSchema)).toEqual(expect.arrayContaining(["type", "name"]));
    // The Mastra tool keeps its id, description and execute.
    expect(wrapped.id).toBe("spec-create");
    expect(wrapped.description).toBe(tool.description);
    expect(wrapped.execute).toBe(tool.execute);
    // The description the agent reads is kept.
    const shape = (wrapped.inputSchema as z.ZodObject).shape as Record<string, z.ZodType>;
    expect(shape.type.description).toMatch(/Document model type/);
    // An empty value is refused like a missing one; the CLI schema still allows it.
    expect((wrapped.inputSchema as z.ZodType).safeParse({ type: "", name: "x" }).success).toBe(false);
    expect(specCreate.inputSchema.safeParse({ name: "x" }).success).toBe(true);
    // The original tool is not mutated.
    expect(required(tool.inputSchema)).not.toContain("type");
  });

  it("marks spec-update's name required", async () => {
    const wrap = await wrapOf();
    const wrapped = wrap("spec-update", await agentTool(specUpdate));
    expect(required(wrapped.inputSchema)).toContain("name");
  });

  it("leaves other tools, and tools without an object schema, as they are", async () => {
    const wrap = await wrapOf();
    const tool = await agentTool(specCreate);
    expect(wrap("spec-list", tool)).toBe(tool);
    const bare = { execute: jest.fn() };
    expect(wrap("spec-create", bare)).toBe(bare);
    expect(requireFields(z.string(), ["type"])).toBeInstanceOf(z.ZodString);
  });

  it("names only fields the commands have", () => {
    expect(AGENT_REQUIRED_INPUTS["spec-create"]).toEqual(["type"]);
    const shape = specCreate.inputSchema.shape as Record<string, unknown>;
    for (const field of AGENT_REQUIRED_INPUTS["spec-create"]) expect(shape[field]).toBeDefined();
  });
});
