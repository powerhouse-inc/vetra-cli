import { actions, type StudioProductState } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { at, productDoc } from "../test-utils/studioFixtures.js";
import { adoptedWithoutVersions, showsFirstVersionBar } from "./firstVersion.js";
import shared from "./adoptedWithoutVersions.cases.json" with { type: "json" };
import { readProduct } from "./useStudioState.js";

const adopted = [
  actions.initProduct({ name: "Old app", idea: "old work", createdAt: at(0) }),
  actions.adoptExisting({
    changeId: "c0",
    request: "Before versions",
    chatSessionIds: [],
    doneSteps: ["PLAN"],
    at: at(0),
  }),
  actions.startChange({
    id: "c1",
    kind: "CHANGE",
    request: "add due dates",
    startedAt: at(1),
  }),
];

function state(...extra: Parameters<typeof productDoc>) {
  return readProduct(productDoc(...adopted, ...extra).state.global);
}

describe("showsFirstVersionBar (X33)", () => {
  it("shows Make it live for a READY change, also while the live check is pending", () => {
    const pending = state();
    const ready = { ...pending.changes[1], status: "READY" as const };
    expect(pending.liveBeforeVersions).toBeNull();
    expect(showsFirstVersionBar(pending, ready)).toBe(true);
    const known = state(
      actions.setLiveBeforeVersions({
        environmentId: "env-old",
        url: "https://old-connect.vetra.io",
        at: at(2),
      }),
    );
    expect(showsFirstVersionBar(known, ready)).toBe(true);
  });

  it("not while building, nor for a product without work from before versions", () => {
    const pending = state();
    expect(showsFirstVersionBar(pending, pending.changes[1])).toBe(false);
    const fresh = readProduct(
      productDoc(
        actions.initProduct({ name: "New", idea: "new", createdAt: at(0) }),
        actions.startChange({
          id: "c1",
          kind: "FIRST_BUILD",
          request: "new",
          startedAt: at(1),
        }),
      ).state.global,
    );
    expect(
      showsFirstVersionBar(fresh, { ...fresh.changes[0], status: "READY" }),
    ).toBe(false);
    expect(showsFirstVersionBar(null, null)).toBe(false);
  });
});

// The same cases run against vetra-cli's twin (src/product/upgrade-existing.ts,
// tests/product/adopted-without-versions.test.ts).
describe("adoptedWithoutVersions (shared cases with vetra-cli)", () => {
  it.each(shared.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(adoptedWithoutVersions(c.state as unknown as StudioProductState)).toBe(
      c.expected,
    );
  });
});
