import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  CONTEXT_LIMIT_RATIO,
  DEFAULT_CONTEXT_LENGTH,
  OPENROUTER_ATTRIBUTION_HEADERS,
  clearContextLimitCache,
  createLlmModels,
  parseFallbacks,
  requestExtras,
  resolveContextTokenLimit,
  resolveLlmSettings,
  resolveOpenRouterKey,
  type LlmSettings,
} from "../../src/agents/llm.js";

const BASE = { model: "anthropic/claude-sonnet-4.6", memoryModel: "anthropic/claude-haiku-4.5", llmAllowDataCollection: false };

function captureFetch() {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(
      JSON.stringify({
        id: "gen-1",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const PROMPT = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }];

describe("resolveOpenRouterKey / resolveLlmSettings", () => {
  it("reads the bare OPENROUTER_API_KEY the broker writes (Review Focus 2)", () => {
    expect(resolveOpenRouterKey({}, { OPENROUTER_API_KEY: "sk-or-v1-broker" })).toBe("sk-or-v1-broker");
    expect(resolveLlmSettings(BASE, { OPENROUTER_API_KEY: "sk-or-v1-broker" })?.apiKey).toBe("sk-or-v1-broker");
  });

  it("prefers the configured key (VETRA_OPENROUTER_API_KEY / config files) and ignores blanks", () => {
    expect(resolveOpenRouterKey({ openrouterApiKey: "sk-or-v1-cfg" }, { OPENROUTER_API_KEY: "sk-or-v1-env" })).toBe("sk-or-v1-cfg");
    expect(resolveOpenRouterKey({ openrouterApiKey: "  " }, { OPENROUTER_API_KEY: " " })).toBeUndefined();
  });

  it("is null without a key, and never reads an Anthropic key", () => {
    expect(resolveLlmSettings(BASE, {})).toBeNull();
    expect(resolveLlmSettings(BASE, { VETRA_ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_API_KEY: "sk-ant-y" })).toBeNull();
  });

  it("defaults the sub-agent to the main model and caps fallbacks at 3", () => {
    const s = resolveLlmSettings(
      { ...BASE, modelFallbacks: "openai/gpt-5, google/gemini-3-pro ,x/a,x/b", openrouterApiKey: "k" },
      {},
    )!;
    expect(s.subagentModel).toBe("anthropic/claude-sonnet-4.6");
    expect(s.fallbacks).toStrictEqual(["openai/gpt-5", "google/gemini-3-pro", "x/a"]);
    expect(resolveLlmSettings({ ...BASE, subagentModel: "x/sub", openrouterApiKey: "k" }, {})!.subagentModel).toBe("x/sub");
    expect(parseFallbacks(undefined)).toStrictEqual([]);
  });
});

describe("requestExtras", () => {
  it("denies data collection by default and allows it only when configured", () => {
    expect(requestExtras("openai/gpt-5", { fallbacks: [], allowDataCollection: false })).toStrictEqual({
      provider: { data_collection: "deny" },
    });
    expect(requestExtras("openai/gpt-5", { fallbacks: [], allowDataCollection: true }).provider).toStrictEqual({
      data_collection: "allow",
    });
  });

  it("sends fallbacks as models [primary, ...fallbacks] without repeating the primary", () => {
    expect(requestExtras("openai/gpt-5", { fallbacks: ["openai/gpt-5", "x/a"], allowDataCollection: false }).models).toStrictEqual([
      "openai/gpt-5",
      "x/a",
    ]);
  });

  it("turns on Anthropic prompt caching only for anthropic/ models", () => {
    expect(requestExtras("anthropic/claude-sonnet-4.6", { fallbacks: [], allowDataCollection: false }).cache_control).toStrictEqual({
      type: "ephemeral",
    });
    expect(requestExtras("openai/gpt-5", { fallbacks: [], allowDataCollection: false })).not.toHaveProperty("cache_control");
  });
});

describe("createLlmModels", () => {
  const settings: LlmSettings = {
    apiKey: "sk-or-v1-test",
    model: "anthropic/claude-sonnet-4.6",
    subagentModel: "openai/gpt-5",
    memoryModel: "anthropic/claude-haiku-4.5",
    fallbacks: ["openai/gpt-5"],
    allowDataCollection: false,
  };

  it("sends the key, the attribution headers, privacy, fallbacks, caching and usage accounting", async () => {
    const { calls, fetchImpl } = captureFetch();
    const models = createLlmModels(settings, { fetch: fetchImpl });
    await models.main.doGenerate({ prompt: PROMPT });
    const [call] = calls;
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call.headers.get("authorization")).toBe("Bearer sk-or-v1-test");
    expect(call.headers.get("http-referer")).toBe("https://vetra.io");
    expect(call.headers.get("x-openrouter-title")).toBe("Vetra Studio");
    expect(OPENROUTER_ATTRIBUTION_HEADERS).toStrictEqual({ "HTTP-Referer": "https://vetra.io", "X-OpenRouter-Title": "Vetra Studio" });
    expect(call.body).toMatchObject({
      model: "anthropic/claude-sonnet-4.6",
      provider: { data_collection: "deny" },
      models: ["anthropic/claude-sonnet-4.6", "openai/gpt-5"],
      cache_control: { type: "ephemeral" },
      usage: { include: true },
    });
  });

  it("builds the sub-agent and memory models on their own ids; memory gets no fallbacks", async () => {
    const { calls, fetchImpl } = captureFetch();
    const models = createLlmModels(settings, { fetch: fetchImpl });
    await models.subagent.doGenerate({ prompt: PROMPT });
    await models.memory.doGenerate({ prompt: PROMPT });
    expect(calls[0].body.model).toBe("openai/gpt-5");
    expect(calls[0].body).not.toHaveProperty("cache_control");
    expect(calls[1].body.model).toBe("anthropic/claude-haiku-4.5");
    expect(calls[1].body).not.toHaveProperty("models");
  });
});

describe("resolveContextTokenLimit", () => {
  beforeEach(() => clearContextLimitCache());

  it("caps the limit at 200k for very large context windows", async () => {
    const big = (async () =>
      new Response(JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-4.6", context_length: 1000000 }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("anthropic/claude-sonnet-4.6", { fetch: big })).toBe(200_000);
  });

  it("uses 80% of the model's context_length, fetched once per model", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return new Response(JSON.stringify({ data: [{ id: "anthropic/claude-haiku-4.5", context_length: 200000 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("anthropic/claude-haiku-4.5", { fetch: fetchImpl })).toBe(160_000);
    expect(await resolveContextTokenLimit("anthropic/claude-haiku-4.5", { fetch: fetchImpl })).toBe(160_000);
    expect(n).toBe(1);
  });

  it("falls back to 80% of 200k when the list is unreachable or lacks the model", async () => {
    const down = (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("x/unknown", { fetch: down })).toBe(Math.floor(DEFAULT_CONTEXT_LENGTH * CONTEXT_LIMIT_RATIO));
    clearContextLimitCache();
    const empty = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("x/unknown", { fetch: empty })).toBe(160_000);
  });
  it("does not pin the fallback after a transient failure: the next call fetches and uses the real value", async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n === 1) throw new Error("timeout");
      return new Response(JSON.stringify({ data: [{ id: "x/flaky", context_length: 100_000 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("x/flaky", { fetch: flaky })).toBe(160_000);
    expect(await resolveContextTokenLimit("x/flaky", { fetch: flaky })).toBe(80_000);
    expect(n).toBe(2);
    expect(await resolveContextTokenLimit("x/flaky", { fetch: flaky })).toBe(80_000);
    expect(n).toBe(2);
  });

  it("does not pin the fallback after a non-OK response either", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return n === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ data: [{ id: "x/busy", context_length: 50_000 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await resolveContextTokenLimit("x/busy", { fetch: f })).toBe(160_000);
    expect(await resolveContextTokenLimit("x/busy", { fetch: f })).toBe(40_000);
  });
});
