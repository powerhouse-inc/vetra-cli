import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { unzipSync, strFromU8 } from "fflate";

import { authorizeSessions } from "../../src/preview-server/session-auth.js";
import { buildSessionExport, listSessions } from "../../src/preview-server/session-export.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const SESSION_ID = "sess-1";
const CHAT_TYPE = "powerhouse/chat-session";

function makeDrive(overrides?: {
  nodes?: unknown;
  session?: unknown;
  ops?: unknown[];
}) {
  const nodes =
    overrides?.nodes ?? [
      { id: SESSION_ID, name: "S", kind: "file", documentType: CHAT_TYPE },
      { id: "other", name: "spec", kind: "file", documentType: "powerhouse/spec" },
    ];
  const session =
    overrides && "session" in overrides
      ? overrides.session
      : {
          header: { id: SESSION_ID },
          state: { global: { threadId: "t-1", resourceId: SESSION_ID, status: "ACTIVE" } },
        };
  const ops = overrides?.ops ?? [{ index: 0 }];
  const client = {
    get: async (id: string) =>
      id === "drive-1"
        ? { state: { global: { nodes } } }
        : id === SESSION_ID
          ? session
          : null,
    getOperations: async () => ({ results: ops, next: undefined }),
  };
  return { reactor: { client }, driveId: "drive-1" } as never;
}

const META = { versions: { vetraCli: "x", ph: "y" }, agentLogging: false };

describe("session-export authorizeSessions", () => {
  const saved = process.env.VETRA_SESSION_EXPORT_SECRET;
  beforeEach(() => delete process.env.VETRA_SESSION_EXPORT_SECRET);
  afterEach(() => {
    if (saved === undefined) delete process.env.VETRA_SESSION_EXPORT_SECRET;
    else process.env.VETRA_SESSION_EXPORT_SECRET = saved;
  });

  it("unset secret: allows direct loopback with no Origin", () => {
    expect(authorizeSessions({}, null)).toBe(true);
  });

  it("unset secret: denies proxied requests (x-forwarded-*)", () => {
    expect(authorizeSessions({ "x-forwarded-prefix": "/preview" }, null)).toBe(false);
    expect(authorizeSessions({ "x-forwarded-for": "1.2.3.4" }, null)).toBe(false);
  });

  it("unset secret: allows a loopback Origin, denies a cross-site Origin", () => {
    expect(authorizeSessions({ origin: "http://localhost:27370" }, null)).toBe(true);
    expect(authorizeSessions({ origin: "http://127.0.0.1:8090" }, null)).toBe(true);
    expect(authorizeSessions({ origin: "https://evil.example" }, null)).toBe(false);
    expect(authorizeSessions({ origin: "null" }, null)).toBe(false);
  });

  it("secret set: requires a matching bearer or token, works through the proxy", () => {
    process.env.VETRA_SESSION_EXPORT_SECRET = "s3cr3t";
    expect(authorizeSessions({}, null)).toBe(false);
    expect(authorizeSessions({ authorization: "Bearer wrong" }, null)).toBe(false);
    expect(authorizeSessions({ authorization: "Bearer s3cr3t" }, null)).toBe(true);
    expect(authorizeSessions({}, "s3cr3t")).toBe(true);
    expect(
      authorizeSessions({ "x-forwarded-prefix": "/preview", authorization: "Bearer s3cr3t" }, null),
    ).toBe(true);
  });
});

describe("session-export listSessions / buildSessionExport", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("lists only chat-session nodes, enriched from doc state", async () => {
    const sessions = await listSessions(makeDrive());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: SESSION_ID, status: "ACTIVE", threadId: "t-1" });
  });

  it("tolerates a non-array nodes field", async () => {
    const sessions = await listSessions(makeDrive({ nodes: { bad: true } }));
    expect(sessions).toEqual([]);
  });

  it("exports a zip with the doc, operations, and metadata (no mastra db here)", async () => {
    const res = await buildSessionExport(makeDrive(), workdir, SESSION_ID, META);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const entries = unzipSync(res.zip);
    const names = Object.keys(entries);
    expect(names).toContain("chat-session.json");
    expect(names).toContain("chat-session-operations.json");
    expect(names).toContain("metadata.json");
    expect(names).not.toContain("mastra-thread.json");
    const meta = JSON.parse(strFromU8(entries["metadata.json"]));
    expect(meta.sources).toMatchObject({ chatSession: true, mastraThread: false });
    expect(meta.threadId).toBe("t-1");
  });

  it("sanitizes the session id in the download filename", async () => {
    const drive = makeDrive();
    const nasty = 'a/b"c\r\nx';
    // Route the nasty id to the same session doc so it resolves.
    (drive as unknown as { reactor: { client: { get: (id: string) => Promise<unknown> } } }).reactor.client.get =
      async (id: string) =>
        id === "drive-1"
          ? { state: { global: { nodes: [] } } }
          : { header: { id }, state: { global: { threadId: null } } };
    const res = await buildSessionExport(drive, workdir, nasty, META);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.filename).toMatch(/^vetra-session-[A-Za-z0-9._-]+\.zip$/);
  });

  it("returns not-found for an unknown session id", async () => {
    const res = await buildSessionExport(makeDrive(), workdir, "nope", META);
    expect(res.kind).toBe("not-found");
  });
});
