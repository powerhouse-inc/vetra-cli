import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { StreamChunk } from "@powerhousedao/ph-clint";
import { createAgent } from "../../src/agents/agent.js";
import { NO_MODEL_MESSAGE, createNoModelAgent } from "../../src/agents/no-model-agent.js";

const EXACT =
  "No model is connected. Open Studio settings → Model to use the Vetra budget or connect your OpenRouter account.";

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

describe("no model connected", () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VETRA_OPENROUTER_API_KEY;
    delete process.env.VETRA_REPLAY_FIXTURE;
    process.env.ANTHROPIC_API_KEY = "sk-ant-must-be-ignored";
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no network in this test");
    });
  });
  afterEach(() => {
    process.env = { ...saved };
    fetchSpy.mockRestore();
  });

  it("answers every chat with the exact connect-a-model message", async () => {
    expect(NO_MODEL_MESSAGE).toBe(EXACT);
    const agent = createNoModelAgent();
    expect(agent.id).toBe("vetra-agent");
    expect(await collect(agent.stream("hello", { threadId: "t1" }))).toStrictEqual([{ type: "text-delta", text: EXACT }]);
    expect(await collect(agent.stream("again", { threadId: "t1" }))).toStrictEqual([{ type: "text-delta", text: EXACT }]);
  });

  it("createAgent serves it without an OpenRouter key (even with an Anthropic key set) and makes no LLM call", async () => {
    const info = jest.fn();
    const ctx = {
      config: {
        model: "anthropic/claude-sonnet-4.6",
        memoryModel: "anthropic/claude-haiku-4.5",
        llmAllowDataCollection: false,
        agentLogging: false,
        anthropicApiKey: "sk-ant-also-ignored",
      },
      context: { log: { info, debug: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      workdir: "/tmp/vetra-no-model-test",
    };
    const agent = await createAgent(ctx as never);
    expect(await collect(agent.stream("build me an app"))).toStrictEqual([{ type: "text-delta", text: EXACT }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("connect-a-model"));
  });
});
