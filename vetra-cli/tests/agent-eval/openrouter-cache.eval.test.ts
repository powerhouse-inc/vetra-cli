/**
 * Live eval (costs real OpenRouter credits): Anthropic prompt caching through
 * OpenRouter, the top-level cache_control that llm.ts sends for anthropic/
 * models. Opt in with:
 *   RUN_AGENT_EVALS=1 OPENROUTER_API_KEY=sk-or-... pnpm --filter vetra-cli test -- tests/agent-eval/openrouter-cache.eval.test.ts
 */
import { describe, it, expect } from "@jest/globals";
import { createLlmModels, resolveLlmSettings } from "../../src/agents/llm.js";

const optedIn = process.env.RUN_AGENT_EVALS === "1";
const describeIfEnabled = optedIn ? describe : describe.skip;

describeIfEnabled("live eval: Anthropic prompt caching through OpenRouter", () => {
  it(
    "reports cached input tokens on the second identical turn",
    async () => {
      const settings = resolveLlmSettings({
        model: "anthropic/claude-sonnet-4.6",
        memoryModel: "anthropic/claude-haiku-4.5",
        llmAllowDataCollection: false,
      });
      if (!settings) throw new Error("set OPENROUTER_API_KEY to run this eval");
      const { main } = createLlmModels(settings);
      // Well above Sonnet's minimum cacheable prefix (1024 tokens).
      const system = "You are terse. Reference: " + "lorem ipsum dolor sit amet consectetur. ".repeat(400);
      const call = () =>
        main.doGenerate({
          prompt: [
            { role: "system", content: system },
            { role: "user", content: [{ type: "text", text: "Reply with OK." }] },
          ],
        } as unknown as Parameters<typeof main.doGenerate>[0]);
      await call();
      const second = await call();
      expect(second.usage.cachedInputTokens ?? 0).toBeGreaterThan(0);
    },
    120_000,
  );
});
