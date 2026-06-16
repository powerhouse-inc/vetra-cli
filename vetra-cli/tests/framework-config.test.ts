import { describe, it, expect } from "@jest/globals";
import { configSchema } from "../src/framework.js";

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
