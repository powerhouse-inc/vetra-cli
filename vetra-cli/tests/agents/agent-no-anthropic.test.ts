import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

// Once an OpenRouter key exists, no path may build an Anthropic model: not the
// main agent, the sub-agents, nor observational memory. Anthropic providers are
// mocked to throw on construction; Agent is mocked to record the model it gets.
const anthropicBuilt = jest.fn();
const agentModels: Array<{ id: string; model: unknown }> = [];
let memoryModel: unknown;

class FakeAgent {
  id: string;
  constructor(opts: { id: string; model: unknown }) {
    this.id = opts.id;
    agentModels.push({ id: opts.id, model: opts.model });
  }
}

jest.unstable_mockModule("@mastra/core/agent", () => ({ Agent: FakeAgent }));
jest.unstable_mockModule("@mastra/core/processors", () => ({ TokenLimiterProcessor: class {} }));
jest.unstable_mockModule("@mastra/mcp", () => ({ MCPClient: class {} }));
jest.unstable_mockModule("@ai-sdk/anthropic", () => ({
  createAnthropic: (...a: unknown[]) => {
    anthropicBuilt("createAnthropic", a);
    throw new Error("anthropic must not be built");
  },
  anthropic: (...a: unknown[]) => {
    anthropicBuilt("anthropic", a);
    throw new Error("anthropic must not be built");
  },
}));
jest.unstable_mockModule("@powerhousedao/ph-clint-claude-subscription", () => ({
  createClaudeSubscriptionModel: (...a: unknown[]) => {
    anthropicBuilt("createClaudeSubscriptionModel", a);
    throw new Error("claude subscription must not be read");
  },
  createUserTokenStore: (...a: unknown[]) => {
    anthropicBuilt("createUserTokenStore", a);
    throw new Error("claude session must not be read");
  },
  resolveClaudeAgentModel: (...a: unknown[]) => {
    anthropicBuilt("resolveClaudeAgentModel", a);
    throw new Error("claude session must not be read");
  },
}));
jest.unstable_mockModule("@powerhousedao/ph-clint/mastra", () => ({
  createMastraHelpers: () => ({
    createMemory: async (o: { observationalMemory: { model: unknown } }) => {
      memoryModel = o.observationalMemory.model;
      return {};
    },
    getAgentInstructions: () => "",
    getTools: async () => ({}),
    createWorkspace: async () => ({}),
    wrapAgent: (a: unknown) => a,
  }),
}));

const { createAgent } = await import("../../src/agents/agent.js");

function isOpenRouterModel(m: unknown): boolean {
  return typeof m === "object" && m !== null && (m as { provider?: string }).provider === "openrouter";
}

describe("agent models with an OpenRouter key", () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    agentModels.length = 0;
    memoryModel = undefined;
    anthropicBuilt.mockClear();
    delete process.env.VETRA_REPLAY_FIXTURE;
    process.env.ANTHROPIC_API_KEY = "sk-ant-ignored";
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("offline");
    });
  });
  afterEach(() => {
    process.env = { ...saved };
    fetchSpy.mockRestore();
  });

  it.each([
    ["the bare OPENROUTER_API_KEY", {}, { OPENROUTER_API_KEY: "sk-or-v1-env" }],
    ["the configured key", { openrouterApiKey: "sk-or-v1-cfg" }, {}],
  ])("builds only OpenRouter models (key from %s), even with Anthropic credentials present", async (_n, extra, env) => {
    delete process.env.OPENROUTER_API_KEY;
    Object.assign(process.env, env);
    const ctx = {
      config: {
        model: "anthropic/claude-sonnet-4.6",
        memoryModel: "anthropic/claude-haiku-4.5",
        llmAllowDataCollection: false,
        agentLogging: false,
        anthropicApiKey: "sk-ant-also-ignored",
        ...extra,
      },
      context: { log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      workdir: "/tmp/vetra-no-anthropic-test",
    };
    await createAgent(ctx as never);

    expect(anthropicBuilt).not.toHaveBeenCalled();
    // main + 3 sub-agents
    expect(agentModels.map((a) => a.id).sort()).toEqual(["agent-app", "agent-document-model", "agent-editor", "vetra-agent"]);
    for (const a of agentModels) expect(isOpenRouterModel(a.model)).toBe(true);
    expect(isOpenRouterModel(memoryModel)).toBe(true);
    // the hardcoded claude-sonnet-4-5 sub-agent id is gone: sub-agents follow the configured model
    for (const a of agentModels) expect((a.model as { modelId: string }).modelId).toBe("anthropic/claude-sonnet-4.6");
    expect((memoryModel as { modelId: string }).modelId).toBe("anthropic/claude-haiku-4.5");
  });
});
