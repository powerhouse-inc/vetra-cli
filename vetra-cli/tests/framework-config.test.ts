import { describe, it, expect } from "@jest/globals";
import { configSchema, secretsSchema } from "../src/framework.js";

describe("OpenRouter config", () => {
  it("defaults the main and memory models to verified OpenRouter ids", () => {
    const c = configSchema.parse({});
    expect(c.model).toBe("anthropic/claude-sonnet-4.6");
    expect(c.memoryModel).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(c.subagentModel).toBeUndefined();
    expect(c.modelFallbacks).toBeUndefined();
    expect(c.llmAllowDataCollection).toBe(false);
  });

  it("coerces VETRA_LLM_ALLOW_DATA_COLLECTION strings", () => {
    expect(configSchema.parse({ llmAllowDataCollection: "true" }).llmAllowDataCollection).toBe(true);
    expect(configSchema.parse({ llmAllowDataCollection: "false" }).llmAllowDataCollection).toBe(false);
  });

  it("declares openrouterApiKey as a secret", () => {
    expect(secretsSchema.parse({ openrouterApiKey: "sk-or-v1-x" }).openrouterApiKey).toBe("sk-or-v1-x");
  });
});
