import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

import { ROUTE_CAPABILITIES, routeCapability } from "../../src/preview-server/route-capabilities.js";

const SRC = join(process.cwd(), "src", "preview-server");

/** Path literals the route modules dispatch on. */
function servedPaths(file: string): string[] {
  const source = readFileSync(join(SRC, file), "utf-8");
  return [...source.matchAll(/path === "([^"]+)"/g)].map((m) => m[1]);
}

describe("ROUTE_CAPABILITIES", () => {
  it("covers every route server.ts and team-routes.ts dispatch on", () => {
    const served = [...servedPaths("server.ts"), ...servedPaths("team-routes.ts")];
    expect(served.length).toBeGreaterThan(10);
    const missing = served.filter((path) => !ROUTE_CAPABILITIES.some((r) => r.path === path));
    expect(missing).toEqual([]);
  });

  it("has no duplicate method+path entries and only known capabilities", () => {
    const keys = ROUTE_CAPABILITIES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(routeCapability("GET", "/healthz")).toBe("public");
    expect(routeCapability("POST", "/start")).toBe("startChange");
    expect(routeCapability("GET", "/team/me")).toBe("view");
    expect(routeCapability("GET", "/nope")).toBeUndefined();
  });
});
