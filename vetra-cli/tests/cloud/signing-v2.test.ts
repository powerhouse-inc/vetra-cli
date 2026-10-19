import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyActionSignature } from "@powerhousedao/reactor";
import type { Action } from "document-model";
import { getRenown } from "../../src/auth/renown.js";

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
    const renown = await getRenown(workdir, "http://127.0.0.1:1");
    const signer = renown.signer;
    // Stand-in for the delegated wallet a console login attaches.
    signer.user = {
      address: "0x1111111111111111111111111111111111111111",
      networkId: "eip155",
      chainId: 1,
    };
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
});
