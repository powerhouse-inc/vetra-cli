import { describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  federationPinTarget,
  installedVersions,
  withFederationOverrides,
} from "../../src/commands/reactor-project/federation-pin.js";

/** Fake pnpm store layout: one dir per resolved package. */
function projectWith(dirs: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "federation-pin-"));
  const store = join(root, "node_modules", ".pnpm");
  mkdirSync(store, { recursive: true });
  for (const dir of dirs) mkdirSync(join(store, dir));
  return root;
}

const SCAFFOLD_YAML = `allowBuilds:
  "@apollo/protobufjs": true
  esbuild: true
overrides:
  date-fns: "4.3.0"
  vite: "8.0.14"
`;

describe("installedVersions", () => {
  it("reads versions out of the pnpm store dir names", () => {
    const root = projectWith([
      "@apollo+gateway@2.14.4_graphql@16.12.0",
      "@apollo+subgraph@2.15.1_graphql@16.12.0",
      "@apollo+subgraph@2.14.4",
    ]);
    expect(installedVersions(root, "@apollo/gateway")).toEqual(["2.14.4"]);
    expect(installedVersions(root, "@apollo/subgraph")).toEqual(["2.14.4", "2.15.1"]);
  });

  it("returns nothing when there is no pnpm store (npm/yarn scaffold)", () => {
    expect(installedVersions(mkdtempSync(join(tmpdir(), "no-store-")), "@apollo/gateway")).toEqual(
      [],
    );
  });
});

describe("federationPinTarget", () => {
  it("pins to the gateway version when subgraph floated ahead", () => {
    const root = projectWith(["@apollo+gateway@2.14.4", "@apollo+subgraph@2.15.1"]);
    expect(federationPinTarget(root)).toBe("2.14.4");
  });

  it("is a no-op when the pair already agrees", () => {
    const root = projectWith(["@apollo+gateway@2.14.4", "@apollo+subgraph@2.14.4"]);
    expect(federationPinTarget(root)).toBeUndefined();
  });

  it("is a no-op when gateway is absent or ambiguous", () => {
    expect(federationPinTarget(projectWith(["@apollo+subgraph@2.15.1"]))).toBeUndefined();
    expect(
      federationPinTarget(projectWith(["@apollo+gateway@2.14.4", "@apollo+gateway@2.15.1"])),
    ).toBeUndefined();
  });
});

describe("withFederationOverrides", () => {
  it("adds both pins under the existing overrides block", () => {
    const out = withFederationOverrides(SCAFFOLD_YAML, "2.14.4");
    expect(out).toContain('overrides:\n  "@apollo/gateway": "2.14.4"\n  "@apollo/subgraph": "2.14.4"');
    // leaves the boilerplate's own pins alone
    expect(out).toContain('date-fns: "4.3.0"');
    expect(out).toContain("esbuild: true");
  });

  it("creates an overrides block when the file has none", () => {
    const out = withFederationOverrides("allowBuilds:\n  esbuild: true\n", "2.14.4");
    expect(out).toContain("allowBuilds:");
    expect(out).toContain('overrides:\n  "@apollo/gateway": "2.14.4"');
  });

  it("is idempotent and re-pins an existing version", () => {
    const once = withFederationOverrides(SCAFFOLD_YAML, "2.14.4");
    expect(withFederationOverrides(once, "2.14.4")).toBe(once);
    const repinned = withFederationOverrides(once, "2.15.1");
    expect(repinned).toContain('"@apollo/subgraph": "2.15.1"');
    expect(repinned).not.toContain("2.14.4");
  });
});
