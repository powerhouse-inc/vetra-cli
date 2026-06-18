import { describe, expect, it } from "@jest/globals";

import { filterOwn } from "../../src/cloud/environments-read.js";
import type { EnvironmentSummary } from "../../src/cloud/graphql.js";

function env(p: Partial<EnvironmentSummary>): EnvironmentSummary {
  return {
    id: "id",
    name: null,
    subdomain: null,
    customDomain: null,
    status: null,
    owner: null,
    createdBy: null,
    ...p,
  };
}

describe("filterOwn", () => {
  const me = "0xABC123";

  it("keeps environments owned by me (case-insensitive)", () => {
    const items = [
      env({ id: "a", owner: "0xabc123" }),
      env({ id: "b", owner: "0xother" }),
    ];
    expect(filterOwn(items, me).map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps unclaimed environments I created", () => {
    const items = [
      env({ id: "a", owner: null, createdBy: "0xABC123" }),
      env({ id: "b", owner: null, createdBy: "0xother" }),
    ];
    expect(filterOwn(items, me).map((e) => e.id)).toEqual(["a"]);
  });

  it("drops environments claimed by someone else even if I created them", () => {
    const items = [env({ id: "a", owner: "0xother", createdBy: "0xabc123" })];
    expect(filterOwn(items, me)).toEqual([]);
  });

  it("returns nothing when the viewer address is unknown", () => {
    expect(filterOwn([env({ owner: "0xabc123" })], undefined)).toEqual([]);
  });
});
