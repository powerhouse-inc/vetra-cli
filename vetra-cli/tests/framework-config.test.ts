import { describe, it, expect } from "@jest/globals";
import { configSchema, secretsSchema } from "../src/framework.js";

// requireApiKey is injected into provisioned envs via the VETRA_REQUIRE_API_KEY
// env var, which arrives as a string. ph-clint does not coerce env values, so
// the field itself must accept "true"/"false" strings as well as real booleans.
describe("configSchema.requireApiKey", () => {
  it("coerces env string 'true' to boolean true", () => {
    expect(configSchema.parse({ requireApiKey: "true" }).requireApiKey).toBe(true);
  });

  it("coerces env string 'false' to boolean false", () => {
    expect(configSchema.parse({ requireApiKey: "false" }).requireApiKey).toBe(false);
  });

  it("passes through a real boolean from JSON config", () => {
    expect(configSchema.parse({ requireApiKey: true }).requireApiKey).toBe(true);
  });

  it("defaults to false when absent", () => {
    expect(configSchema.parse({}).requireApiKey).toBe(false);
  });
});

describe("OpenRouter config", () => {
  it("defaults the main and memory models to verified OpenRouter ids", () => {
    const c = configSchema.parse({});
    expect(c.model).toBe("anthropic/claude-sonnet-4.6");
    expect(c.memoryModel).toBe("anthropic/claude-haiku-4.5");
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
