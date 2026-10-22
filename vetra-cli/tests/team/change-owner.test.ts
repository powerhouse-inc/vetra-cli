import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StudioProductV1 } from "vetra-app/document-models";
import type { ISigner } from "@powerhousedao/shared/document-model";

// Task 1.11: the agent works for the change's owner. The owner is the accepted
// signer of START_CHANGE (trust ledger), and the agent's writes for that change
// are signed with that member's own delegation — never a Studio-wide identity.

const MAKER = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const VIEWER = "0x3333333333333333333333333333333333333333";
const PRODUCT_DOC = "product-1";
const DRIVE_ID = "drive-1";
const NOW = Date.parse("2026-10-22T10:00:00.000Z");
const AT = "2026-10-22T09:59:00.000Z";

const { createTrustLedger } = await import("../../src/team/trust.js");
const { createChangeOwnerSource } = await import("../../src/team/change-owner.js");
const { ChangeAccessError, dispatchProduct } = await import("../../src/product/product-doc.js");
const { pauseForAccess, accessPauseText } = await import("../../src/agents/pause.js");
const { signedOperation, signerFor } = await import("./team-fixtures.js");

const a = StudioProductV1.actions;

function productDoc() {
  return StudioProductV1.reducer(
    StudioProductV1.utils.createDocument(),
    a.startChange({ id: "c1", kind: "CHANGE", request: "make it blue", startedAt: AT }),
  );
}

const dirs: string[] = [];
function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-change-owner-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const roleOf = (address: string) =>
  address === OWNER ? "owner" : address === MAKER ? "maker" : address === VIEWER ? "viewer" : null;

function ledgerIn(dir: string) {
  return createTrustLedger(dir, {
    resolveMember: async (address) => {
      const role = roleOf(address);
      return role ? { role, name: role === "maker" ? "Mia" : null } : null;
    },
    checkDelegation: async () => true,
    now: () => NOW,
  });
}

async function startOpFor(
  signer: ISigner,
  index: number,
  changeId: string,
) {
  return signedOperation(signer, PRODUCT_DOC, index, "START_CHANGE", {
    id: changeId,
    kind: "CHANGE",
    request: "make it blue",
    startedAt: AT,
  });
}

describe("change owner", () => {
  it("is the accepted START_CHANGE signer, and signs with their delegation", async () => {
    const dir = freshDir();
    const makerSigner = await signerFor(dir, MAKER);
    const op = await startOpFor(makerSigner, 1, "c1");
    const source = createChangeOwnerSource({
      readProduct: async () => ({ documentId: PRODUCT_DOC, operations: [op] }),
      ledger: ledgerIn(dir),
      member: async (address) => {
        const role = roleOf(address);
        return role ? { address, name: role === "maker" ? "Mia" : null, role, reviewer: false } : null;
      },
      signer: async (address) => (address === MAKER ? makerSigner : null),
      dropDelegation: jest.fn(),
    });

    expect(await source.changeOwner({ id: "c1" })).toEqual({ address: MAKER, name: "Mia" });
    expect(await source.signerForChange({ id: "c1" })).toBe(makerSigner);
    await expect(source.changeAccess({ id: "c1" })).resolves.toMatchObject({
      kind: "ok",
      owner: { address: MAKER },
    });
  });

  it("two changes use their own owner's signer", async () => {
    const dir = freshDir();
    const makerSigner = await signerFor(dir, MAKER);
    const ownerDir = freshDir();
    const ownerSigner = await signerFor(ownerDir, OWNER);
    const ops = [
      await startOpFor(makerSigner, 1, "c1"),
      await startOpFor(ownerSigner, 2, "c2"),
    ];
    const source = createChangeOwnerSource({
      readProduct: async () => ({ documentId: PRODUCT_DOC, operations: ops }),
      ledger: ledgerIn(dir),
      member: async (address) => {
        const role = roleOf(address);
        return role ? { address, name: null, role, reviewer: false } : null;
      },
      signer: async (address) =>
        address === MAKER ? makerSigner : address === OWNER ? ownerSigner : null,
      dropDelegation: jest.fn(),
    });

    expect((await source.signerForChange({ id: "c1" }))?.user?.address).toBe(MAKER);
    expect((await source.signerForChange({ id: "c2" }))?.user?.address).toBe(OWNER);
  });

  it("refuses a change started by someone without the capability", async () => {
    const dir = freshDir();
    const viewerSigner = await signerFor(dir, VIEWER);
    const op = await startOpFor(viewerSigner, 1, "c1");
    const source = createChangeOwnerSource({
      readProduct: async () => ({ documentId: PRODUCT_DOC, operations: [op] }),
      ledger: ledgerIn(dir),
      member: async (address) => ({
        address,
        name: null,
        role: "viewer",
        reviewer: false,
      }),
      signer: async () => viewerSigner,
      dropDelegation: jest.fn(),
    });

    expect(await source.changeOwner({ id: "c1" })).toBeNull();
    expect(await source.signerForChange({ id: "c1" })).toBeNull();
  });

  it("a removed owner pauses the change: no signer, delegation dropped", async () => {
    const dir = freshDir();
    const makerSigner = await signerFor(dir, MAKER);
    const op = await startOpFor(makerSigner, 1, "c1");
    const dropDelegation = jest.fn();
    const source = createChangeOwnerSource({
      readProduct: async () => ({ documentId: PRODUCT_DOC, operations: [op] }),
      ledger: ledgerIn(dir),
      member: async () => null,
      signer: async () => makerSigner,
      dropDelegation,
    });

    const access = await source.changeAccess({ id: "c1" });
    expect(access.kind).toBe("removed");
    expect(dropDelegation).toHaveBeenCalledWith(MAKER);
    expect(await source.signerForChange({ id: "c1" })).toBeNull();
  });
});

describe("agent writes for a change", () => {
  function clientFor(doc: unknown, executed: unknown[][]) {
    return {
      get: async (id: string) =>
        id === DRIVE_ID
          ? {
              state: {
                global: {
                  nodes: [{ id: PRODUCT_DOC, kind: "file", documentType: "vetra/studio-product" }],
                },
              },
            }
          : doc,
      execute: async (_id: string, _branch: string, actions: unknown[]) => {
        executed.push(actions);
      },
    };
  }

  it("are signed by the change owner", async () => {
    const dir = freshDir();
    const makerSigner = await signerFor(dir, MAKER);
    const executed: unknown[][] = [];
    const doc = productDoc();
    const ctx = {
      workdir: dir,
      folders: {},
      config: { studioOrgId: "org-1" },
      reactor: async () => ({ client: clientFor(doc, executed), driveId: DRIVE_ID }),
      changeOwnerDeps: {
        readProduct: async () => null,
        member: async (address: string) => ({
          address,
          name: "Mia",
          role: "maker" as const,
          reviewer: false,
        }),
        signer: async () => makerSigner,
        dropDelegation: () => {},
        ledger: createTrustLedger(dir, {
          resolveMember: async () => null,
          checkDelegation: async () => false,
          now: () => NOW,
        }),
      },
    };

    // The change-owner seam resolves the owner from the ledger; give it the
    // op the browser wrote, signed by the maker.
    const op = await startOpFor(makerSigner, 1, "c1");
    const scripted = {
      ...ctx,
      changeOwnerDeps: {
        ...ctx.changeOwnerDeps,
        readProduct: async () => ({ documentId: PRODUCT_DOC, operations: [op] }),
        ledger: createTrustLedger(dir, {
          resolveMember: async () => ({ role: "maker" as const, name: "Mia" }),
          checkDelegation: async () => true,
          now: () => NOW,
        }),
      },
    };

    await dispatchProduct(
      scripted,
      [a.addMilestone({ changeId: "c1", id: "m1", text: "blue", at: AT })],
    );

    expect(executed).toHaveLength(1);
    const [action] = executed[0] as Array<{ context?: { signer?: { user?: { address?: string } } } }>;
    expect(action.context?.signer?.user?.address).toBe(MAKER);
  });

  it("are refused once the owner is removed (nothing is written)", async () => {
    const dir = freshDir();
    const makerSigner = await signerFor(dir, MAKER);
    const executed: unknown[][] = [];
    const doc = productDoc();
    const op = await startOpFor(makerSigner, 1, "c1");
    const ctx = {
      workdir: dir,
      folders: {},
      config: { studioOrgId: "org-1" },
      reactor: async () => ({ client: clientFor(doc, executed), driveId: DRIVE_ID }),
      changeOwnerDeps: {
        readProduct: async () => ({ documentId: PRODUCT_DOC, operations: [op] }),
        ledger: ledgerIn(dir),
        member: async () => null,
        signer: async () => makerSigner,
        dropDelegation: () => {},
      },
    };

    await expect(
      dispatchProduct(
        ctx,
        [a.addMilestone({ changeId: "c1", id: "m1", text: "blue", at: AT })],
      ),
    ).rejects.toBeInstanceOf(ChangeAccessError);
    expect(executed).toHaveLength(0);
  });
});

describe("access pause", () => {
  it("says why in plain words", () => {
    expect(accessPauseText("Mia", true)).toBe("Paused — Mia no longer has access");
    expect(accessPauseText("Mia", false)).toBe(
      "Waiting for Mia to allow the Studio's agent to work for them",
    );
  });

  it("writes PAUSE_CHANGE and the milestone, signed by another member", async () => {
    const dir = freshDir();
    const ownerDir = freshDir();
    const otherSigner = await signerFor(ownerDir, OWNER);
    type WrittenAction = { type: string; context?: { signer?: { user?: { address?: string } } } };
    const executed: WrittenAction[][] = [];
    const doc = productDoc();
    const driveDoc = {
      state: {
        global: {
          nodes: [{ id: PRODUCT_DOC, kind: "file", documentType: "vetra/studio-product" }],
        },
      },
    };
    const ctx = {
      workdir: dir,
      folders: {},
      config: { studioOrgId: "org-1" },
      reactor: async () => ({
        client: {
          get: async (id: string) => (id === DRIVE_ID ? driveDoc : doc),
          execute: async (_id: string, _branch: string, actions: WrittenAction[]) => {
            executed.push(actions);
          },
        },
        driveId: DRIVE_ID,
      }),
    };

    const wrote = await pauseForAccess(
      ctx,
      "c1",
      { kind: "removed", owner: { address: MAKER, name: "Mia" } },
      { signer: async () => otherSigner },
    );

    expect(wrote).toBe(true);
    expect(executed).toHaveLength(1);
    const types = executed[0].map((action) => action.type);
    expect(types).toEqual(["PAUSE_CHANGE", "ADD_MILESTONE"]);
    const milestone = executed[0][1] as unknown as { input: { text: string } };
    expect(milestone.input.text).toBe("Paused — Mia no longer has access");
    for (const action of executed[0]) {
      expect(action.context?.signer?.user?.address).toBe(OWNER);
    }
  });
});
