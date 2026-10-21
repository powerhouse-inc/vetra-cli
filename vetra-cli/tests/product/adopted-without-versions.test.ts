/**
 * adoptedWithoutVersions has a twin in vetra-app
 * (editors/vetra-studio/shell/firstVersion.ts) that the CLI can't import
 * without the editor bundle. Both run the same cases, kept with the vetra-app
 * one, so the agent's auto-launch gate and the page's Make it live bar never
 * disagree.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import { adoptedWithoutVersions } from "../../src/product/upgrade-existing.js";

const CASES = fileURLToPath(
  new URL("../../../vetra-app/editors/vetra-studio/shell/adoptedWithoutVersions.cases.json", import.meta.url),
);
const { cases } = JSON.parse(readFileSync(CASES, "utf-8")) as {
  cases: { name: string; state: unknown; expected: boolean }[];
};

describe("adoptedWithoutVersions (shared cases with vetra-app)", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(5);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(adoptedWithoutVersions(c.state as StudioProductState)).toBe(c.expected);
  });
});
