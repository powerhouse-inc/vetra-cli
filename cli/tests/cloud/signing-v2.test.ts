import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyActionSignature } from "@powerhousedao/reactor";
import {
  applyCreateEnvironment,
  createNewEnvironmentController,
} from "../../../cloud-client/index.js";
import type { ReactorGraphQLClient } from "@powerhousedao/reactor-browser";
import {
  deserializeSignature,
  protocolVersionsFor,
  type Action,
  type ISigner,
  type TransportAction,
} from "document-model";
import { openAgentSession } from "../../src/auth/renown.js";

const USER = {
  address: "0x1111111111111111111111111111111111111111",
  networkId: "eip155",
  chainId: 1,
};

/** The agent's session signer for `workdir`: its session key signs as the
 * Renown agent's does, here for the pseudonym of a temporary home. */
async function renownSigner(workdir: string): Promise<ISigner> {
  vi.stubEnv("PH_IDENTITY_HOME", path.join(workdir, "identities"));
  vi.stubEnv("PH_USER_DATA_DIR", undefined);
  try {
    return (await openAgentSession(path.join(workdir, "studio"), { cloud: false }))
      .actionSigner;
  } finally {
    vi.unstubAllEnvs();
  }
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
    if (!signer.user) throw new Error("Renown signer has no user");

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
    let envId = "";
    const pushed: TransportAction[] = [];
    // Only the create + push half of the remote; the pull after it is refused.
    // The host's create defaults are the prod cloud's; the document is created
    // under its own header id, as a switchboard does.
    const client = {
      GetCreateDefaults: () =>
        Promise.resolve({
          createDefaults: {
            signaturePolicy: "v2-required",
            protocolVersions: protocolVersionsFor("v2-required"),
          },
        }),
      CreateDocument: (vars: { document: { header: { id: string } } }) => {
        envId = vars.document.header.id;
        return Promise.resolve({ createDocument: { id: envId } });
      },
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

    expect(envId).not.toBe("");
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
