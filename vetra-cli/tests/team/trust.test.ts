import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createTrustLedger,
  TrustStoreError,
  TrustUnavailableError,
  TRUST_FILE,
  verifySignedOperation,
} from "../../src/team/trust.js";
import { DelegationUnavailableError } from "../../src/team/delegation-check.js";
import { OTHER, OWNER, signedOperation, signerFor, unsignedOperation } from "./team-fixtures.js";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const DOC = "doc-team";
const OTHER_DOC = "doc-other";
const ctxInput = { required: true, at: "2026-10-21T10:00:00.000Z" };

function setup(opts: { allowUnsignedInit?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-trust-"));
  const checkDelegation = jest.fn(async () => true);
  const resolveMember = jest.fn(async (address: string) =>
    address.toLowerCase() === OWNER ? { role: "owner" as const, name: null } : null,
  );
  const ledger = createTrustLedger(dir, {
    resolveMember,
    checkDelegation,
    now: () => NOW,
    allowUnsignedInit: opts.allowUnsignedInit,
  });
  return { dir, ledger, checkDelegation, resolveMember };
}

const isOwner = (m: { role: string }) => m.role === "owner";

describe("trust ledger", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  function freshLedger(opts: { allowUnsignedInit?: boolean } = {}) {
    const s = setup(opts);
    dirs.push(s.dir);
    return s;
  }

  it("a valid v2 operation from a member is accepted", async () => {
    const { dir, ledger } = freshLedger();
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    const verdict = await ledger.judge(DOC, op, isOwner);
    expect(verdict).toMatchObject({ ok: true, address: OWNER, role: "owner", reason: null });
    expect(ledger.accepted(DOC, [op])).toEqual([op]);
    expect(ledger.verdicts(DOC)["0:hash-0"]).toMatchObject({ ok: true, address: OWNER });
  });

  it("an unsigned operation is refused", async () => {
    const { ledger } = freshLedger();
    const op = unsignedOperation(1, "SET_REVIEW_REQUIRED", ctxInput);
    expect(await ledger.judge(DOC, op, isOwner)).toMatchObject({ ok: false, reason: "UNSIGNED" });
    expect(ledger.accepted(DOC, [op])).toEqual([]);
  });

  it("the unsigned INIT_TEAM is accepted only at index 0, only for local Studios", async () => {
    const local = freshLedger({ allowUnsignedInit: true });
    const init = unsignedOperation(0, "INIT_TEAM", { orgId: null, reviewRequired: false, at: "x" });
    expect(await local.ledger.judge(DOC, init, isOwner)).toMatchObject({ ok: true, address: null });

    const atOne = unsignedOperation(1, "INIT_TEAM", { orgId: null, reviewRequired: false, at: "x" });
    expect(await local.ledger.judge(DOC, atOne, isOwner)).toMatchObject({ ok: false, reason: "UNSIGNED" });

    const cloud = freshLedger();
    const cloudInit = unsignedOperation(0, "INIT_TEAM", { orgId: "acme", reviewRequired: true, at: "x" });
    expect(await cloud.ledger.judge(DOC, cloudInit, isOwner)).toMatchObject({
      ok: false,
      reason: "UNSIGNED",
    });
  });

  it("a signature for another document is refused (replay across Studios)", async () => {
    const { dir, ledger } = freshLedger();
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, OTHER_DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    const verdict = await ledger.judge(DOC, op, isOwner);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/BAD_SIGNATURE|WRONG_DOCUMENT/);
    expect(ledger.accepted(DOC, [op])).toEqual([]);
  });

  it("a key not delegated by the address is refused", async () => {
    const { dir, ledger, checkDelegation } = freshLedger();
    checkDelegation.mockResolvedValue(false);
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "ADD_REVIEWER", { address: OTHER, at: "x" });
    expect(await ledger.judge(DOC, op, isOwner)).toMatchObject({ ok: false, reason: "NOT_DELEGATED" });
    expect(ledger.accepted(DOC, [op])).toEqual([]);
  });

  it("a non-owner's accepted signature grants nothing", async () => {
    const { dir, ledger } = freshLedger();
    const signer = await signerFor(dir, OTHER);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    expect(await ledger.judge(DOC, op, isOwner)).toMatchObject({
      ok: false,
      address: OTHER,
      role: null,
      reason: "NOT_MEMBER",
    });
    expect(ledger.accepted(DOC, [op])).toEqual([]);
  });

  it("the verdict is stable after the member is removed", async () => {
    const { dir, ledger, resolveMember } = freshLedger();
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    expect((await ledger.judge(DOC, op, isOwner)).ok).toBe(true);

    resolveMember.mockResolvedValue(null);
    expect(await ledger.judge(DOC, op, isOwner)).toMatchObject({ ok: true, role: "owner" });
    expect(ledger.accepted(DOC, [op])).toEqual([op]);
  });

  it("the ledger survives a restart", async () => {
    const { dir, ledger } = freshLedger();
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    await ledger.judge(DOC, op, isOwner);

    const restarted = createTrustLedger(dir, {
      resolveMember: jest.fn(async () => null),
      checkDelegation: jest.fn(async () => false),
      now: () => NOW,
    });
    // No judge call: the stored verdict alone decides.
    expect(restarted.accepted(DOC, [op])).toEqual([op]);
    expect(restarted.verdicts(DOC)["0:hash-0"]).toMatchObject({ ok: true, address: OWNER });
  });

  it("a delegation lookup failure records nothing", async () => {
    const { dir, ledger, checkDelegation } = freshLedger();
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    checkDelegation.mockRejectedValueOnce(new DelegationUnavailableError("down"));
    await expect(ledger.judge(DOC, op, isOwner)).rejects.toBeInstanceOf(TrustUnavailableError);
    expect(ledger.accepted(DOC, [op])).toEqual([]);

    expect(await ledger.judge(DOC, op, isOwner)).toMatchObject({ ok: true });
  });

  it("a corrupt ledger fails closed instead of re-judging", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-trust-"));
    dirs.push(dir);
    fs.mkdirSync(path.dirname(path.join(dir, TRUST_FILE)), { recursive: true });
    fs.writeFileSync(path.join(dir, TRUST_FILE), "{ not json");
    const ledger = createTrustLedger(dir, {
      resolveMember: jest.fn(async () => ({ role: "owner" as const, name: null })),
      checkDelegation: jest.fn(async () => true),
      now: () => NOW,
    });
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    await expect(ledger.judge(DOC, op, isOwner)).rejects.toBeInstanceOf(TrustStoreError);
  });

  it("accepted filters by type and ignores unjudged operations", async () => {
    const { dir, ledger } = freshLedger();
    const signer = await signerFor(dir);
    const add = await signedOperation(signer, DOC, 0, "ADD_REVIEWER", { address: OTHER, at: "x" });
    const set = await signedOperation(signer, DOC, 1, "SET_REVIEW_REQUIRED", ctxInput);
    await ledger.judge(DOC, add, isOwner);
    expect(ledger.accepted(DOC, [add, set])).toEqual([add]);
    expect(ledger.accepted(DOC, [add, set], "SET_REVIEW_REQUIRED")).toEqual([]);
  });
});

describe("verifySignedOperation", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the signer's address and app key for a v2 signature", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-trust-"));
    dirs.push(dir);
    const signer = await signerFor(dir);
    const op = await signedOperation(signer, DOC, 0, "SET_REVIEW_REQUIRED", ctxInput);
    const result = await verifySignedOperation(op, { documentId: DOC, branch: "main" }, async () => true);
    expect(result).toEqual({ address: OWNER, appKey: signer.app?.key });
  });
});
