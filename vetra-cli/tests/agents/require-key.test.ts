import { describe, it, expect } from "@jest/globals";
import { assertCredentialIfRequired } from "../../src/agents/require-key.js";

describe("assertCredentialIfRequired", () => {
  it("throws a clear error when a credential is required but none resolved", () => {
    expect(() => assertCredentialIfRequired("none", true)).toThrow(/not provisioned/i);
  });

  it("does not throw when a credential is present (api-key)", () => {
    expect(() => assertCredentialIfRequired("api-key", true)).not.toThrow();
  });

  it("does not throw when a credential is present (subscription)", () => {
    expect(() => assertCredentialIfRequired("subscription", true)).not.toThrow();
  });

  it("does not throw when not required, even with no credential (local-dev demo path)", () => {
    expect(() => assertCredentialIfRequired("none", false)).not.toThrow();
  });
});
