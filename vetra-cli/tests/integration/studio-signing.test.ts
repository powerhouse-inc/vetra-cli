/**
 * A cloud Studio's reactor signs its first-run documents; a local Studio stays
 * legacy (Task 5.SIG, ruling X39).
 *
 * The cloud reactor is built exactly as `cli.ts` builds it: the plan from
 * `planStudioSigning` (marker committed first), the signing option from
 * `studioReactorSigning`, and the drive config from `cloudStudioDriveConfig`.
 * The product/chat documents are then created through that reactor, and every
 * one of them is `v2-required` and signed by the owner.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, webcrypto } from "node:crypto";
import {
  baseCreateDocument,
  createAction,
  createReducer,
  createState,
  defaultBaseState,
  isDocumentAction,
  signaturePolicyOf,
  withSignaturePolicy,
  actionSignerIdentity,
  signActionV2,
} from "document-model";
import type { DocumentModelModule } from "document-model";
import {
  buildDefaultReactor,
  deterministicId,
} from "@powerhousedao/ph-clint";
import type {
  DriveEntry,
  ReactorContext,
} from "@powerhousedao/ph-clint";
import type { IRenown } from "@renown/sdk/node";
import {
  cloudStudioDriveConfig,
  readStudioDrivePointer,
  studioReactorSigning,
} from "../../src/auth/reactor-signing.js";
import {
  commitStudioSigningPlan,
  planStudioSigning,
} from "../../src/auth/studio-mode.js";

/* ── A real P-256 did:key signer (v2 tuples the reactor verifies) ────────── */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const OWNER = {
  address: "0x00000000000000000000000000000000000000a1",
  networkId: "eip155",
  chainId: 1,
};

interface TestSigner {
  user?: typeof OWNER;
  app: { name: string; key: string };
  publicKey: CryptoKey;
  sign(data: Uint8Array): Promise<Uint8Array>;
  verify(): Promise<void>;
  signAction(action: unknown, target: unknown): Promise<unknown>;
}

async function createTestSigner(): Promise<TestSigner> {
  const keys = (await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    await webcrypto.subtle.exportKey("raw", keys.publicKey),
  );
  const x = raw.slice(1, 33);
  const yOdd = raw[64] & 1;
  const compressed = new Uint8Array([yOdd ? 3 : 2, ...x]);
  const did = `did:key:z${base58(new Uint8Array([0x80, 0x24, ...compressed]))}`;
  const sign = async (data: Uint8Array) =>
    new Uint8Array(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        data,
      ),
    );
  const signer: TestSigner = {
    user: undefined,
    app: { name: "test-agent", key: did },
    publicKey: keys.publicKey,
    sign,
    async verify() {},
    async signAction(action, target) {
      return signActionV2({
        action,
        target,
        signer: actionSignerIdentity(signer as never),
        sign,
        previousStateHash: (action as { context?: { prevOpHash?: string } })
          .context?.prevOpHash ?? "",
      } as never);
    },
  };
  return signer;
}

/* ── Minimal document models (the wiring is what is under test) ──────────── */

function modelDocument(type: string): DocumentModelModule {
  const createStateFor = (state?: any): any => ({
    ...defaultBaseState(),
    ...state,
    document: { version: 1, ...state?.document },
    global: { lines: [], ...state?.global },
    local: { ...state?.local },
  });
  return {
    version: 1,
    reducer: createReducer((state: any, action: any) => {
      if (isDocumentAction(action)) return state;
      if (action.type === "ADD_LINE") state.global.lines.push(action.input.text);
      return state;
    }),
    actions: {},
    utils: {
      fileExtension: "doc",
      createState: createStateFor,
      createDocument: (state?: any) => baseCreateDocument(createStateFor, state, type),
      saveToFileHandle: async () => {},
      loadFromInput: async () => {
        throw new Error("not supported in this fixture");
      },
      isStateOfType: () => true,
      assertIsStateOfType: () => {},
      isDocumentOfType: () => true,
      assertIsDocumentOfType: () => {},
    },
    documentModel: createState(defaultBaseState(), {
      id: type,
      name: type,
      extension: "doc",
      description: "",
      author: { name: "", website: "" },
      specifications: [
        {
          version: 1,
          changeLog: [],
          state: {
            global: { schema: "", initialValue: '{"lines":[]}', examples: [] },
            local: { schema: "", initialValue: "{}", examples: [] },
          },
          modules: [],
        },
      ],
    } as never),
  } as unknown as DocumentModelModule;
}

const NOTE = modelDocument("test/note");
const CHAT = modelDocument("test/chat");
const PRODUCT = modelDocument("test/product");

/* ── Fixture helpers ─────────────────────────────────────────────────────── */

const roots: string[] = [];
const reactors: ReactorContext[] = [];

function makeWorkdir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), `studio-signing-${randomBytes(3).toString("hex")}-`));
  roots.push(dir);
  return dir;
}

function setupContext(workdir: string) {
  const emitted: string[] = [];
  return {
    workdir,
    config: {},
    workspace: {
      getStoreFolder: (p?: string) =>
        p ? path.join(workdir, ".ph", "vetra", p) : path.join(workdir, ".ph", "vetra"),
    },
    emit: (event: string) => emitted.push(event),
    emitted,
  } as never;
}

function fakeRenown(signer: TestSigner) {
  return {
    signer,
    on: () => () => {},
  } as unknown as IRenown;
}

afterAll(async () => {
  for (const reactor of reactors) {
    try {
      await reactor.shutdown();
    } catch {}
  }
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
});

async function cloudReactor(workdir: string) {
  const signer = await createTestSigner();
  signer.user = OWNER;
  // Exactly the boot sequence: the marker is committed before the reactor is
  // built, so a restart can never fall back to legacy.
  const plan = planStudioSigning(workdir, { environmentId: "env-1" }, {});
  commitStudioSigningPlan(workdir, plan);
  const { signing } = await studioReactorSigning({
    workdir,
    renownUrl: "https://renown.invalid",
    adminsEnv: OWNER.address,
    renown: fakeRenown(signer),
  });
  const reactor = await buildDefaultReactor(setupContext(workdir), {
    documentModels: [NOTE, CHAT, PRODUCT],
    drive: cloudStudioDriveConfig(workdir, {
      preferredEditor: "vetra-studio",
      canCreate: () => Boolean(signer.user),
    }),
    signing,
    subscriptions: {},
  });
  reactors.push(reactor);
  return { reactor, signer };
}

describe("a new cloud Studio", () => {
  it("creates its drive and its product/chat documents v2-required, signed by the owner", async () => {
    const workdir = makeWorkdir();
    const { reactor } = await cloudReactor(workdir);

    // The drive exists under a derived (not fixed) id and is recorded.
    expect(reactor.driveId).toBeTruthy();
    expect(reactor.driveId).not.toBe(deterministicId("vetra", workdir));
    expect(readStudioDrivePointer(workdir)).toBe(reactor.driveId);

    const drive = (await reactor.client.get(reactor.driveId)) as {
      header: never;
    };
    expect(signaturePolicyOf(drive.header)).toBe("v2-required");

    // The documents the Studio creates first: the product and a chat session.
    for (const [model, name] of [
      [PRODUCT, "Product"],
      [CHAT, "Session 1"],
    ] as const) {
      const doc = withSignaturePolicy(model.utils.createDocument(), "v2-required");
      doc.header.name = name;
      await reactor.client.drives.addFile(reactor.driveId, doc as never);
      const created = (await reactor.client.get(doc.header.id)) as {
        header: never;
      };
      expect(signaturePolicyOf(created.header)).toBe("v2-required");
    }

    const nodes = (
      (await reactor.client.get(reactor.driveId)) as {
        state: { global: { nodes: Array<{ kind: string; documentType?: string }> } };
      }
    ).state.global.nodes;
    expect(nodes.filter((n) => n.kind === "file").map((n) => n.documentType)).toEqual(
      expect.arrayContaining(["test/product", "test/chat"]),
    );

    // Every write carries the owner's signature (`user` set to the owner, key
    // is the agent's delegated did:key) — not an unsigned operation.
    const productId = (
      (await reactor.client.get(reactor.driveId)) as {
        state: { global: { nodes: Array<{ id: string; documentType?: string }> } };
      }
    ).state.global.nodes.find((n) => n.documentType === "test/product")?.id;
    expect(productId).toBeTruthy();
    const ops = await reactor.client.getOperations(productId as string);
    const signer = (
      ops.results.at(-1) as {
        action?: { context?: { signer?: { user?: { address?: string } } } };
      }
    )?.action?.context?.signer;
    expect(signer?.user?.address).toBe(OWNER.address);
  }, 60_000);

  it("refuses when the signer has no user and records no drive", async () => {
    const workdir = makeWorkdir();
    const signer = await createTestSigner();
    signer.user = undefined;
    const plan = planStudioSigning(workdir, { environmentId: "env-1" }, {});
    commitStudioSigningPlan(workdir, plan);
    const { signing } = await studioReactorSigning({
      workdir,
      renownUrl: "https://renown.invalid",
      adminsEnv: OWNER.address,
      renown: fakeRenown(signer),
    });
    const reactor = await buildDefaultReactor(setupContext(workdir), {
      documentModels: [NOTE, CHAT],
      drive: cloudStudioDriveConfig(workdir, {
        canCreate: () => Boolean(signer.user),
      }),
      signing,
      subscriptions: {},
    });
    reactors.push(reactor);

    // Deferred: no drive, and nothing was written.
    expect(reactor.driveId).toBe("");
    expect(readStudioDrivePointer(workdir)).toBeUndefined();
    await expect(reactor.client.createEmpty("test/chat")).rejects.toThrow(
      /cannot sign/i,
    );
    expect(readStudioDrivePointer(workdir)).toBeUndefined();
  }, 60_000);
});

describe("a local Studio", () => {
  it("keeps the legacy policy and the fixed drive id", async () => {
    const workdir = makeWorkdir();
    const plan = planStudioSigning(workdir, {}, {});
    expect(plan.mode).toBe("legacy");
    commitStudioSigningPlan(workdir, plan);

    const reactor = await buildDefaultReactor(setupContext(workdir), {
      documentModels: [NOTE, CHAT],
      drive: {
        name: "Home",
        id: deterministicId("vetra", path.resolve(workdir)),
        preferredEditor: "vetra-studio",
      },
      subscriptions: {},
    });
    reactors.push(reactor);

    expect(reactor.driveId).toBe(deterministicId("vetra", path.resolve(workdir)));
    const drive = (await reactor.client.get(reactor.driveId)) as {
      header: never;
    };
    expect(signaturePolicyOf(drive.header)).toBe("legacy");
    // Writes stay unsigned, exactly as today.
    const doc = await reactor.client.createEmpty("test/chat");
    expect(signaturePolicyOf(doc.header as never)).toBe("legacy");
    const written = (await reactor.client.execute(doc.header.id, "main", [
      createAction("ADD_LINE", { text: "unsigned" }, undefined, undefined, "global"),
    ])) as { header: unknown };
    expect(written.header).toBeTruthy();
    expect(readStudioDrivePointer(workdir)).toBeUndefined();
    expect(reactor.drives).toHaveLength(1);
    const entries = reactor.drives as DriveEntry[];
    expect(entries[0].id).toBe(reactor.driveId);
  }, 60_000);
});
