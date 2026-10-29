import { describe, expect, it } from "@jest/globals";

import {
  canApproveChanges,
  describePendingChange,
  matchEnvironments,
  pendingChanges,
  type EnvironmentSummary,
} from "@powerhousedao/vetra-cloud-client";

const op = (type: string, input: unknown = {}) => ({ action: { type, input } });

describe("pendingChanges", () => {
  it("returns user edits after the last APPROVE_CHANGES, skipping lifecycle ops", () => {
    const ops = [
      op("ADD_PACKAGE", { packageName: "old" }),
      op("APPROVE_CHANGES"),
      op("MARK_CHANGES_PUSHED"),
      op("REPORT_DEPLOYMENT_SUCCEEDED"),
      op("ADD_PACKAGE", { packageName: "@acme/todo", version: "1.2.0" }),
      op("REMOVE_PACKAGE", { packageName: "@acme/old" }),
    ];
    expect(pendingChanges(ops).map((c) => c.type)).toEqual([
      "ADD_PACKAGE",
      "REMOVE_PACKAGE",
    ]);
  });

  it("returns every edit when nothing was ever approved", () => {
    expect(pendingChanges([op("SET_LABEL", { label: "x" })])).toHaveLength(1);
    expect(pendingChanges(undefined)).toEqual([]);
  });
});

describe("describePendingChange", () => {
  it("phrases known edits and falls back to type + input", () => {
    expect(
      describePendingChange({
        type: "ADD_PACKAGE",
        input: { packageName: "@acme/todo", version: "1.2.0" },
      }),
    ).toBe("add package @acme/todo@1.2.0");
    expect(
      describePendingChange({
        type: "REMOVE_PACKAGE",
        input: { packageName: "@acme/todo" },
      }),
    ).toBe("remove package @acme/todo");
    expect(
      describePendingChange({ type: "SET_CUSTOM_DOMAIN", input: { domain: "a.b" } }),
    ).toBe('SET_CUSTOM_DOMAIN {"domain":"a.b"}');
  });
});

describe("canApproveChanges", () => {
  it("mirrors the reducer: DRAFT and CHANGES_PENDING only", () => {
    expect(canApproveChanges("CHANGES_PENDING")).toBe(true);
    expect(canApproveChanges("DRAFT")).toBe(true);
    expect(canApproveChanges("READY")).toBe(false);
    expect(canApproveChanges(null)).toBe(false);
  });
});

describe("matchEnvironments", () => {
  const env = (id: string, name: string | null, subdomain: string | null) =>
    ({ id, name, subdomain, customDomain: null, status: "READY", owner: null, createdBy: null }) as EnvironmentSummary;
  const items = [
    env("id-1", "Shop", "bold-fox-11111111"),
    env("id-2", "shop", "calm-elk-22222222"),
    env("id-3", "Blog", "keen-yak-33333333"),
  ];

  it("matches by id, subdomain, or case-insensitive name", () => {
    expect(matchEnvironments(items, "id-3").map((e) => e.id)).toEqual(["id-3"]);
    expect(matchEnvironments(items, "keen-yak-33333333").map((e) => e.id)).toEqual(["id-3"]);
    expect(matchEnvironments(items, "BLOG").map((e) => e.id)).toEqual(["id-3"]);
  });

  it("returns every match for an ambiguous name and none for unknown/blank", () => {
    expect(matchEnvironments(items, "shop").map((e) => e.id)).toEqual(["id-1", "id-2"]);
    expect(matchEnvironments(items, "nope")).toEqual([]);
    expect(matchEnvironments(items, "  ")).toEqual([]);
  });
});
