import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ISigner } from "@powerhousedao/shared/document-model";

import { createTrustLedger, type Operation, type TrustLedger } from "../../src/team/trust.js";
import {
  acceptedTeamState,
  createAcceptedTeam,
  TeamDocumentMismatchError,
} from "../../src/team/team-state.js";
import { OWNER, signedOperation, signerFor, unsignedOperation } from "./team-fixtures.js";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const DOC = "doc-team";
const ORG = "acme-bau";
const R1 = "0x3333333333333333333333333333333333333333";
const R2 = "0x4444444444444444444444444444444444444444";
const M = "0x5555555555555555555555555555555555555555";
const G = "0x6666666666666666666666666666666666666666";
const AT = "2026-10-21T10:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function fixture(orgId: string | null = ORG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-team-"));
  dirs.push(dir);
  const signer = await signerFor(dir);
  const ledger: TrustLedger = createTrustLedger(dir, {
    resolveMember: async (address) =>
      address.toLowerCase() === OWNER ? { role: "owner", name: null } : null,
    checkDelegation: async () => true,
    now: () => NOW,
  });
  return { dir, signer, ledger, orgId };
}

async function teamOps(signer: ISigner): Promise<Operation[]> {
  return [
    await signedOperation(signer, DOC, 0, "INIT_TEAM", { orgId: ORG, reviewRequired: true, at: AT }),
    await signedOperation(signer, DOC, 1, "ADD_REVIEWER", { address: R1, name: "Rita", at: AT }),
    await signedOperation(signer, DOC, 2, "ADD_REVIEWER", { address: R2, name: "Rolf", at: AT }),
    await signedOperation(signer, DOC, 3, "REMOVE_REVIEWER", { address: R1 }),
    await signedOperation(signer, DOC, 4, "SET_ROLE_OVERRIDE", { address: M, role: "VIEWER", at: AT }),
    await signedOperation(signer, DOC, 5, "INVITE_GUEST", {
      id: "g1",
      address: G,
      name: "Gus",
      changeId: "change-1",
      rights: "COMMENT",
      expiresAt: "2026-10-22T10:00:00.000Z",
      invitedAt: AT,
    }),
    await signedOperation(signer, DOC, 6, "REVOKE_GUEST", { id: "g1", at: AT }),
    await signedOperation(signer, DOC, 7, "SET_MEMBER_LIMIT", { address: M, monthlyUsd: 100, at: AT }),
    await signedOperation(signer, DOC, 8, "CLEAR_MEMBER_LIMIT", { address: M }),
    await signedOperation(signer, DOC, 9, "SET_REVIEW_REQUIRED", { required: false, at: AT }),
  ];
}

describe("acceptedTeamState", () => {
  it("builds the state from accepted operations: reviewers ADD minus REMOVE, latest overrides/limits", async () => {
    const { signer, ledger, orgId } = await fixture();
    const ops = await teamOps(signer);
    const state = await acceptedTeamState(ledger, orgId, { documentId: DOC, operations: ops });
    expect(state).toMatchObject({
      initialized: true,
      orgId: ORG,
      reviewRequired: false,
      roleOverrides: [{ address: M, role: "VIEWER", at: AT }],
      memberLimits: [],
    });
    expect(state.reviewers.map((r) => r.address)).toEqual([R2]);
    expect(state.reviewers[0]).toMatchObject({ name: "Rolf", addedAt: AT });
    expect(state.guests).toHaveLength(1);
    expect(state.guests[0]).toMatchObject({ id: "g1", address: G, revokedAt: AT });
  });

  it("an unaccepted (unsigned) operation changes nothing", async () => {
    const { signer, ledger, orgId } = await fixture();
    const ops = await teamOps(signer);
    ops.push(unsignedOperation(10, "ADD_REVIEWER", { address: "0x7777777777777777777777777777777777777777", at: AT }));
    const state = await acceptedTeamState(ledger, orgId, { documentId: DOC, operations: ops });
    expect(state.reviewers.map((r) => r.address)).toEqual([R2]);
  });

  it("refuses a team document naming another organisation", async () => {
    const { signer, ledger, orgId } = await fixture();
    const ops = [
      await signedOperation(signer, DOC, 0, "INIT_TEAM", { orgId: "other-org", reviewRequired: true, at: AT }),
    ];
    await expect(
      acceptedTeamState(ledger, orgId, { documentId: DOC, operations: ops }),
    ).rejects.toBeInstanceOf(TeamDocumentMismatchError);
  });

  it("a personal Studio document is refused by an org Studio and vice versa", async () => {
    const { signer, ledger, orgId } = await fixture();
    const personal = [
      await signedOperation(signer, DOC, 0, "INIT_TEAM", { orgId: null, reviewRequired: false, at: AT }),
    ];
    await expect(
      acceptedTeamState(ledger, orgId, { documentId: DOC, operations: personal }),
    ).rejects.toBeInstanceOf(TeamDocumentMismatchError);
    // The same doc read by a personal Studio (orgId null) is fine.
    expect(
      await acceptedTeamState(ledger, null, { documentId: DOC, operations: personal }),
    ).toMatchObject({ initialized: true, orgId: null, reviewRequired: false });
  });

  it("without an accepted INIT_TEAM an org Studio reviews by default; a personal one does not", async () => {
    const { ledger } = await fixture();
    expect(await acceptedTeamState(ledger, ORG, { documentId: DOC, operations: [] })).toMatchObject({
      initialized: false,
      reviewRequired: true,
    });
    expect(await acceptedTeamState(ledger, null, { documentId: DOC, operations: [] })).toMatchObject({
      initialized: false,
      reviewRequired: false,
    });
  });
});

describe("createAcceptedTeam", () => {
  it("invalidates once when the accepted team operations change, never on the first read", async () => {
    const { signer, ledger, orgId } = await fixture();
    const ops = await teamOps(signer);
    let current: { documentId: string; operations: Operation[] } = { documentId: DOC, operations: ops };
    const changed = jest.fn();
    const read = createAcceptedTeam({
      orgId,
      ledger,
      readDocument: async () => current,
      onAcceptedChange: changed,
    });

    await read();
    await read();
    expect(changed).not.toHaveBeenCalled();

    current = {
      documentId: DOC,
      operations: [
        ...ops,
        await signedOperation(signer, DOC, 10, "SET_REVIEW_REQUIRED", { required: true, at: AT }),
      ],
    };
    await read();
    expect(changed).toHaveBeenCalledTimes(1);
    await read();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("returns the safe default when there is no team document yet", async () => {
    const { ledger, orgId } = await fixture();
    const changed = jest.fn();
    const read = createAcceptedTeam({ orgId, ledger, readDocument: async () => null, onAcceptedChange: changed });
    expect(await read()).toMatchObject({ initialized: false, reviewRequired: true });
    expect(changed).not.toHaveBeenCalled();
  });
});
