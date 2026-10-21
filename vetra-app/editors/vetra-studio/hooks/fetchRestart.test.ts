import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRestart } from "./preview-server-client.js";

const urls: string[] = [];

function respond(status: number, body: unknown): void {
  urls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const response = url.endsWith("studio.config.json")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(body), { status });
      return Promise.resolve(response);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRestart", () => {
  it("posts /restart for the project and returns the result", async () => {
    respond(202, { kind: "started", project: "hotel" });
    expect(await fetchRestart({ project: "hotel" })).toMatchObject({
      kind: "started",
    });
    expect(urls.some((u) => u.includes("/restart?project=hotel"))).toBe(true);
  });

  it("returns null on a Studio without /restart, so the caller can start", async () => {
    respond(404, { error: "not found", path: "/restart" });
    expect(await fetchRestart({ project: "hotel" })).toBeNull();
  });

  it("a refused restart says so and never falls back to a start", async () => {
    respond(403, { error: "forbidden" });
    await expect(fetchRestart({ project: "hotel" })).rejects.toThrow(
      "Couldn't restart the preview.",
    );
    expect(urls.some((u) => u.includes("/start"))).toBe(false);
  });

  it("an unknown project is a result, not a missing route", async () => {
    respond(404, { kind: "unknown-project", project: "x", error: "nope" });
    expect(await fetchRestart({ project: "x" })).toMatchObject({
      kind: "unknown-project",
    });
  });
});
