import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyActionSignature } from "@powerhousedao/reactor";
import {
  applyCreateEnvironment,
  createNewEnvironmentController,
} from "@powerhousedao/vetra-cloud-client";
import type { ReactorGraphQLClient } from "@powerhousedao/reactor-browser";
import {
  deserializeSignature,
  type Action,
  type ISigner,
  type TransportAction,
} from "document-model";
import { getRenown } from "../../src/auth/renown.js";

const USER = {
  address: "0x1111111111111111111111111111111111111111",
  networkId: "eip155",
  chainId: 1,
};

/** The vetra-cli Renown signer for `workdir`, with a stand-in for the
 * delegated wallet a console login attaches. */
async function renownSigner(workdir: string): Promise<ISigner> {
  const renown = await getRenown(workdir, "http://127.0.0.1:1");
  renown.signer.user = USER;
  return renown.signer;
}

/** A pushed wire action back in the shape the switchboard verifies. */
function fromWire(action: TransportAction): Action {
  const signer = action.context?.signer;
  return {
    ...action,
    context: {
      ...action.context,
      signer: signer && {
        user: signer.user,
        app: signer.app,
        signatures: signer.signatures.map(deserializeSignature),
      },
    },
  } as Action;
}

// The prod cloud switchboard admits environment-document actions only under
// the `v2-required` policy; a legacy tuple is refused with SCHEME_BELOW_POLICY.
describe("Renown signing for Vetra Cloud", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(os.tmpdir(), "vetra-signing-v2-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("Renown signer produces a v2 tuple the shared verifier accepts as v2-required", async () => {
    const signer = await renownSigner(workdir);
    if (!signer.app) throw new Error("Renown signer has no app identity");

    const target = { documentId: "fake-env-id", branch: "main" };
    const action: Action = {
      id: "set-label-1",
      type: "SET_LABEL",
      scope: "global",
      timestampUtcMs: new Date().toISOString(),
      input: { label: "My environment" },
    };

    const tuple = await signer.signAction(action, target);
    const signed: Action = {
      ...action,
      context: {
        signer: { user: signer.user, app: signer.app, signatures: [tuple] },
      },
    };

    const verdict = await verifyActionSignature(
      signed,
      { ...target, policy: "v2-required" },
      "mutation",
    );

    expect(verdict).toEqual({ ok: true, scheme: "v2" });
  });

  it("environment controller pushes v2-signed actions", async () => {
    const envId = "fake-env-id";
    const pushed: TransportAction[] = [];
    // Only the create + push half of the remote; the pull after it is refused.
    const client = {
      CreateEmptyDocument: () =>
        Promise.resolve({ createEmptyDocument: { id: envId } }),
      MutateDocument: (vars: { actions: TransportAction[] }) => {
        pushed.push(...vars.actions);
        return Promise.resolve({ mutateDocument: { id: envId } });
      },
      GetDocument: () => Promise.reject(new Error("pull not faked")),
      GetDocumentWithOperations: () =>
        Promise.reject(new Error("pull not faked")),
    } as unknown as ReactorGraphQLClient;

    const controller = createNewEnvironmentController({
      client,
      parentIdentifier: "drive-1",
      signer: await renownSigner(workdir),
    });
    applyCreateEnvironment(controller, {
      address: USER.address,
      label: "My environment",
      defaultPackageRegistry: "https://registry.vetra.io",
    });
    await expect(controller.push()).rejects.toThrow("pull not faked");

    expect(pushed.map((a) => a.type)).toEqual(
      expect.arrayContaining(["SET_OWNER", "SET_LABEL", "INITIALIZE"]),
    );
    for (const action of pushed) {
      const verdict = await verifyActionSignature(
        fromWire(action),
        { documentId: envId, branch: "main", policy: "v2-required" },
        "mutation",
      );
      expect({ type: action.type, verdict }).toEqual({
        type: action.type,
        verdict: { ok: true, scheme: "v2" },
      });
    }
  });
});
