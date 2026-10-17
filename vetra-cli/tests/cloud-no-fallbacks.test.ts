/**
 * No cloud fallbacks: an unconfigured switchboard or registry fails loudly
 * instead of silently using staging / the dev registry.
 */
import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCloudGraphqlEndpoint } from "../src/cloud/config.js";
import { resolveRegistryUrl } from "../src/cloud/registry-url.js";

describe("cloud switchboard", () => {
  it("has no default", () => {
    expect(() => resolveCloudGraphqlEndpoint({})).toThrow(
      /VETRA_CLOUD_SWITCHBOARD_URL/,
    );
  });
  it("uses the configured switchboard", () => {
    expect(
      resolveCloudGraphqlEndpoint({
        cloudSwitchboardUrl: "https://switchboard.vetra.io/",
      }),
    ).toBe("https://switchboard.vetra.io/graphql");
  });
});

describe("package registry", () => {
  const empty = () => mkdtempSync(path.join(tmpdir(), "vetra-reg-"));

  it("has no default", () => {
    expect(() => resolveRegistryUrl({ projectPath: empty(), env: {} })).toThrow(
      /No package registry configured/,
    );
  });
  it("flag > PH_REGISTRY_URL > powerhouse.config.json", () => {
    const dir = empty();
    writeFileSync(
      path.join(dir, "powerhouse.config.json"),
      '{"packageRegistryUrl":"https://from-config"}',
    );
    expect(resolveRegistryUrl({ projectPath: dir, env: {} })).toBe(
      "https://from-config",
    );
    expect(
      resolveRegistryUrl({
        projectPath: dir,
        env: { PH_REGISTRY_URL: "https://registry.vetra.io" },
      }),
    ).toBe("https://registry.vetra.io");
    expect(
      resolveRegistryUrl({
        registry: "https://flag",
        projectPath: dir,
        env: { PH_REGISTRY_URL: "https://registry.vetra.io" },
      }),
    ).toBe("https://flag");
  });
});
