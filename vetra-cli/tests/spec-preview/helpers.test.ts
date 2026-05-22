import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";

import {
  findPreviewByName,
  getPreviewDriveId,
  resolvePreviewEndpoint,
} from "../../src/helpers/reactor-project-preview.js";

const PROJECT_PATH = "/tmp/some-reactor-project";
const SWITCHBOARD_URL = "http://localhost:5555/graphql";

function makeServices(instances: Array<{
  status: string;
  workdir?: string;
  endpoints?: Record<string, string>;
}>) {
  return {
    list: () => instances,
  } as never;
}

describe("getPreviewDriveId", () => {
  it("matches the ph-cli generateProjectDriveId('preview') derivation", () => {
    const expectedHash = crypto
      .createHash("sha256")
      .update(PROJECT_PATH)
      .digest("hex")
      .slice(0, 8);
    expect(getPreviewDriveId(PROJECT_PATH)).toBe(`preview-${expectedHash}`);
  });

  it("is deterministic for the same path", () => {
    const a = getPreviewDriveId(PROJECT_PATH);
    const b = getPreviewDriveId(PROJECT_PATH);
    expect(a).toBe(b);
  });

  it("differs for different paths", () => {
    expect(getPreviewDriveId("/a")).not.toBe(getPreviewDriveId("/b"));
  });
});

describe("resolvePreviewEndpoint", () => {
  it("throws when no service manager is available", () => {
    expect(() => resolvePreviewEndpoint(undefined, PROJECT_PATH, "demo")).toThrow(
      /service manager not available/i,
    );
  });

  it("throws with a start-hint when no live instance matches the path", () => {
    const services = makeServices([
      { status: "stopped", workdir: PROJECT_PATH },
      { status: "ready", workdir: "/other/path" },
    ]);
    expect(() =>
      resolvePreviewEndpoint(services, PROJECT_PATH, "demo"),
    ).toThrow(/reactor-project-start demo/);
  });

  it("treats 'starting' instances as live but errors when endpoint not captured yet", () => {
    const services = makeServices([
      { status: "starting", workdir: PROJECT_PATH },
    ]);
    expect(() =>
      resolvePreviewEndpoint(services, PROJECT_PATH, "demo"),
    ).toThrow(/starting up/i);
  });

  it("returns the switchboard URL and computed driveId for a ready instance", () => {
    const services = makeServices([
      {
        status: "ready",
        workdir: PROJECT_PATH,
        endpoints: { "vetra-switchboard": SWITCHBOARD_URL },
      },
    ]);
    const result = resolvePreviewEndpoint(services, PROJECT_PATH, "demo");
    expect(result.switchboardUrl).toBe(SWITCHBOARD_URL);
    expect(result.driveId).toBe(getPreviewDriveId(PROJECT_PATH));
  });
});

describe("findPreviewByName", () => {
  const driveId = "preview-abcd1234";
  const items = [
    { id: "doc-1", slug: "alpha", name: "Alpha", documentType: "x", revisionsList: [] },
    { id: "doc-2", slug: "beta", name: "Beta", documentType: "x", revisionsList: [] },
    { id: "doc-3", slug: "gamma", name: "Gamma", documentType: "x", revisionsList: [] },
  ];

  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: { findDocuments: { items } } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("matches by display name", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "Beta");
    expect(row.id).toBe("doc-2");
  });

  it("matches by slug when name doesn't match", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "gamma");
    expect(row.id).toBe("doc-3");
  });

  it("matches by id when name and slug don't match", async () => {
    const row = await findPreviewByName(SWITCHBOARD_URL, driveId, "doc-1");
    expect(row.id).toBe("doc-1");
  });

  it("throws with candidates when nothing matches", async () => {
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "missing"),
    ).rejects.toThrow(/missing/);
  });

  it("throws on ambiguous name match", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              findDocuments: {
                items: [
                  { id: "a", slug: "a", name: "Same", documentType: "x", revisionsList: [] },
                  { id: "b", slug: "b", name: "Same", documentType: "x", revisionsList: [] },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "Same"),
    ).rejects.toThrow(/multiple/i);
  });
});

describe("gqlRequest error paths (via findPreviewByName)", () => {
  const driveId = "preview-abcd1234";
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("surfaces GraphQL errors with the joined messages", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ errors: [{ message: "boom" }, { message: "kaboom" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "anything"),
    ).rejects.toThrow(/boom; kaboom/);
  });

  it("surfaces HTTP failures with status code and body", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response("server exploded", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    await expect(
      findPreviewByName(SWITCHBOARD_URL, driveId, "anything"),
    ).rejects.toThrow(/502/);
  });
});
