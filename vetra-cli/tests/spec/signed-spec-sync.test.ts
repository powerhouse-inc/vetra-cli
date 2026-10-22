/**
 * Specs in a v2-required cloud Studio (Task 5.SIG, ruling X39): the FS is no
 * longer replayed unsigned. A file the reactor does not have is created through
 * the agent's client (signed) — a legacy file gets a new signed document from
 * its state — and the `.phd` is rewritten from the signed document.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signaturePolicyOf } from "document-model";
import {
  applyFsChangesToReactor,
  mirrorSignedSpec,
} from "../../src/helpers/spec-drive-sync.js";
import {
  createSpecDocument,
  loadSpecDocument,
  saveSpec,
} from "../../src/commands/spec/registry.js";

const TYPE = "powerhouse/document-model";

let workdir: string;
const log = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "signed-spec-"));
  jest.clearAllMocks();
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

interface FakeReactor {
  client: {
    get: jest.Mock;
    create: jest.Mock;
    execute: jest.Mock;
    addRelationship: jest.Mock;
  };
}

function fakeReactor(docs = new Map<string, unknown>()): FakeReactor {
  const client = {
    get: jest.fn((id: string) => {
      if (id === "drive-1") {
        return Promise.resolve({ state: { global: { nodes: [] } } });
      }
      if (docs.has(id)) return Promise.resolve(docs.get(id));
      return Promise.reject(new Error(`no document ${id}`));
    }),
    create: jest.fn((doc: { header: { id: string } }) => {
      docs.set(doc.header.id, doc);
      return Promise.resolve(doc);
    }),
    execute: jest.fn(() => Promise.resolve({})),
    addRelationship: jest.fn(() => Promise.resolve({})),
  };
  return { client };
}

describe("applyFsChangesToReactor in a v2 Studio", () => {
  it("creates a signed document from a legacy file and rewrites the file", async () => {
    const legacy = createSpecDocument(TYPE, { name: "Signed later" });
    const filePath = await saveSpec(legacy, workdir);
    const { client } = fakeReactor();

    const synced = await applyFsChangesToReactor(
      [filePath],
      workdir,
      { client } as never,
      "drive-1",
      log,
      undefined,
      { signatureMode: "v2-required" },
    );

    expect(synced).toBe(1);
    expect(client.create).toHaveBeenCalledTimes(1);
    const created = client.create.mock.calls[0][0] as {
      header: { id: string; name: string };
    };
    expect(signaturePolicyOf(created.header as never)).toBe("v2-required");
    expect(created.header.id).not.toBe(legacy.header.id);
    expect(created.header.name).toBe("Signed later");

    // The file now holds the signed document, under its derived id.
    const onDisk = await loadSpecDocument(filePath);
    expect(onDisk.header.id).toBe(created.header.id);
    expect(signaturePolicyOf(onDisk.header)).toBe("v2-required");
    // ... and it is attached to the drive (signed execute).
    expect(client.execute).toHaveBeenCalledWith(
      "drive-1",
      "main",
      expect.anything(),
    );
  });

  it("executes only actions the reactor does not have yet", async () => {
    const doc = createSpecDocument(TYPE, {
      name: "Existing",
      signaturePolicy: "v2-required",
    });
    const filePath = await saveSpec(doc, workdir);
    const onDisk = await loadSpecDocument(filePath);
    const firstOp = (onDisk.operations.global ?? [])[0] as
      | { action?: { id?: string } }
      | undefined;

    const docs = new Map<string, unknown>([[doc.header.id, onDisk]]);
    const { client } = fakeReactor(docs);
    client.get.mockImplementation((id: string) => {
      if (id === "drive-1") return Promise.resolve({ state: { global: { nodes: [] } } });
      return docs.has(id)
        ? Promise.resolve(docs.get(id))
        : Promise.reject(new Error("missing"));
    });
    // The reactor already has every global action in the file.
    (client as unknown as { getOperations: jest.Mock }).getOperations = jest.fn(() =>
      Promise.resolve({
        results: (onDisk.operations.global ?? []).map((op: unknown) => op),
      }),
    );

    const synced = await applyFsChangesToReactor(
      [filePath],
      workdir,
      { client } as never,
      "drive-1",
      log,
      undefined,
      { signatureMode: "v2-required" },
    );

    expect(synced).toBe(1);
    expect(client.create).not.toHaveBeenCalled();
    // Nothing new to sign: no unsigned operation is submitted either.
    const executedActions = client.execute.mock.calls
      .filter((call) => call[0] !== "drive-1")
      .flatMap((call) => call[2] as unknown[]);
    expect(executedActions).not.toContainEqual(
      expect.objectContaining({ id: firstOp?.action?.id }),
    );
  });

  it("refuses instead of submitting when the write cannot be signed", async () => {
    const doc = createSpecDocument(TYPE, {
      name: "Cannot sign",
      signaturePolicy: "v2-required",
    });
    const filePath = await saveSpec(doc, workdir);
    const { client } = fakeReactor();
    client.create.mockRejectedValue(
      Object.assign(new Error("The agent cannot sign a new document yet"), {
        name: "SignerNotReadyError",
      }),
    );

    const synced = await applyFsChangesToReactor(
      [filePath],
      workdir,
      { client } as never,
      "drive-1",
      log,
      undefined,
      { signatureMode: "v2-required" },
    );

    expect(synced).toBe(0);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("mirrorSignedSpec", () => {
  it("writes the reactor's operations over the .phd", async () => {
    const doc = createSpecDocument(TYPE, {
      name: "Mirrored",
      signaturePolicy: "v2-required",
    });
    const { client } = fakeReactor(
      new Map([[doc.header.id, { ...doc, state: doc.state }]]),
    );
    (client as unknown as { getOperations: jest.Mock }).getOperations = jest.fn(() =>
      Promise.resolve({ results: doc.operations.global ?? [] }),
    );

    const written = await mirrorSignedSpec(
      client as never,
      doc.header.id,
      workdir,
      log,
    );

    expect(written).toBeTruthy();
    const onDisk = await loadSpecDocument(written as string);
    expect(onDisk.header.id).toBe(doc.header.id);
    expect(onDisk.operations.global?.length ?? 0).toBe(
      doc.operations.global?.length ?? 0,
    );
  });
});
