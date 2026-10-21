/**
 * First-run order in a new cloud Studio (Task 5.SIG, ruling X39): when the
 * daemon booted before the agent was authorized, the Studio drive is created
 * the moment writes become possible, and the Connect bundle is pointed at it.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readStudioDrivePointer } from "../../src/auth/reactor-signing.js";
import { studioBootstrapTrigger } from "../../src/triggers/studio-bootstrap.js";

let workdir: string;
let vetraAppDir: string;
const log = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "studio-bootstrap-"));
  vetraAppDir = mkdtempSync(path.join(tmpdir(), "studio-bootstrap-app-"));
  mkdirSync(path.join(vetraAppDir, "dist/connect"), { recursive: true });
  writeFileSync(
    path.join(vetraAppDir, "dist/connect/powerhouse.config.json"),
    JSON.stringify({ connect: { drives: { defaultDrives: [{ url: "/d/" }] } } }),
  );
  writeFileSync(
    path.join(vetraAppDir, "dist/connect/studio.config.json"),
    JSON.stringify({ previewServerUrl: "https://slug.vetra.io/preview" }),
  );
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(vetraAppDir, { recursive: true, force: true });
});

function fakeReactor(options: { ready: boolean } = { ready: true }) {
  const client = {
    get: jest.fn(() => Promise.reject(new Error("not found"))),
    getDocumentModelModule: jest.fn(() =>
      Promise.resolve({
        utils: {
          createDocument: () => ({
            header: {
              id: "",
              documentType: "powerhouse/document-drive",
              meta: {},
            },
            state: { document: { version: 1 } },
          }),
        },
      }),
    ),
    create: jest.fn((doc: { header: { id: string } }) =>
      Promise.resolve({ header: { ...doc.header, id: "drive-new" } }),
    ),
    rename: jest.fn(() => Promise.resolve()),
  };
  const reactor = {
    client,
    _module: { reactor: { findByType: jest.fn(() => Promise.resolve({ results: [] })) } },
    driveId: "",
    personalDriveId: undefined as string | undefined,
    drives: [] as Array<{ id: string; name: string; role: string }>,
    writes: { ready: () => options.ready },
    switchboardUrl: "http://localhost:4001/graphql",
  };
  return { reactor, client };
}

function triggerContext(
  reactor: unknown,
  config: Record<string, unknown>,
): { ctx: never; handlers: Array<() => void> } {
  const handlers: Array<() => void> = [];
  const ctx = {
    context: { config, workdir, log },
    reactor: () => Promise.resolve(reactor),
    commandContext: {
      proxy: { url: "https://slug.vetra.io" },
      on: (_event: string, handler: () => void) => {
        handlers.push(handler);
        return () => {};
      },
    },
  };
  return { ctx: ctx as never, handlers };
}

function makeTrigger() {
  return studioBootstrapTrigger({ vetraAppDir });
}

describe("studio-bootstrap", () => {
  it("creates the drive once writes are possible and points Connect at it", async () => {
    const { reactor, client } = fakeReactor();
    const { ctx } = triggerContext(reactor, { environmentId: "env-1" });
    const printed: string[] = [];
    const logSpy = jest.spyOn(console, "log").mockImplementation((line: unknown) => {
      printed.push(String(line));
    });

    await makeTrigger().setup?.(ctx);
    logSpy.mockRestore();

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(reactor.driveId).toBe("drive-new");
    expect(reactor.personalDriveId).toBe("drive-new");
    expect(reactor.drives).toEqual([
      { id: "drive-new", name: "Home", role: "personal" },
    ]);
    expect(readStudioDrivePointer(workdir)).toBe("drive-new");
    expect(printed).toContain("Vetra Studio: https://slug.vetra.io/d/drive-new");

    const connect = JSON.parse(
      readFileSync(
        path.join(vetraAppDir, "dist/connect/powerhouse.config.json"),
        "utf8",
      ),
    );
    expect(connect.connect.drives.defaultDrives[0].url).toBe(
      "https://slug.vetra.io/switchboard/d/drive-new",
    );
    const studio = JSON.parse(
      readFileSync(path.join(vetraAppDir, "dist/connect/studio.config.json"), "utf8"),
    );
    expect(studio.studioDriveId).toBe("drive-new");
  });

  it("holds while the signer cannot sign, then creates on writes:ready", async () => {
    const { reactor, client } = fakeReactor({ ready: false });
    const { ctx, handlers } = triggerContext(reactor, { environmentId: "env-1" });

    await makeTrigger().setup?.(ctx);
    expect(client.create).not.toHaveBeenCalled();
    expect(reactor.driveId).toBe("");
    expect(readStudioDrivePointer(workdir)).toBeUndefined();

    // The owner delegates; the reactor announces that writes are possible.
    reactor.writes = { ready: () => true };
    for (const handler of handlers) handler();
    await new Promise((resolve) => setImmediate(resolve));

    expect(reactor.driveId).toBe("drive-new");
    expect(readStudioDrivePointer(workdir)).toBe("drive-new");
  });

  it("does nothing in a local Studio", async () => {
    const { reactor, client } = fakeReactor();
    const { ctx } = triggerContext(reactor, {});
    await makeTrigger().setup?.(ctx);
    expect(client.create).not.toHaveBeenCalled();
    expect(readStudioDrivePointer(workdir)).toBeUndefined();
  });
});
