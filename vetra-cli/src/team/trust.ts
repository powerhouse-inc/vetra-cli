/**
 * The trust ledger (P6-2): security decisions read only operations whose v2
 * signature is valid for this document, whose app key the signer's wallet
 * delegated on Renown, and whose signer had the required role *when the Studio
 * first saw the operation*. The first verdict is stored in
 * `.ph/vetra/team/trust.json` and never recomputed, so removing a member does
 * not retroactively void what they provably did.
 *
 * Security-sensitive:
 * - a lookup that cannot answer (Renown down, lookups capped) throws
 *   `TrustUnavailableError` and records nothing: the caller refuses now and
 *   retries later, rather than freezing a refusal caused by an outage;
 * - a corrupt ledger file is an error, never an empty ledger (re-judging a
 *   removed member's old operations against today's roles would fail open).
 *
 * The ledger file lives in the Studio's workdir, the same trust boundary as
 * the team document id; it is written atomically with mode 0600.
 */
import fs from "node:fs";
import path from "node:path";
import { verifyActionSignature } from "@powerhousedao/reactor";
import type { Action } from "@powerhousedao/shared/document-model";

import type { DelegationCheck } from "./delegation-check.js";
import type { Member, StudioRoleName } from "./roles.js";

export const TRUST_FILE = path.join(".ph", "vetra", "team", "trust.json");

/** The operation fields the ledger needs (a powerhouse `Operation` subset). */
export interface Operation {
  id: string;
  index: number;
  hash: string;
  timestampUtcMs: string;
  action: Action;
}

export interface OperationTarget {
  documentId: string;
  branch: "main";
}

export type SignatureRefusal = "UNSIGNED" | "BAD_SIGNATURE" | "WRONG_DOCUMENT" | "NOT_DELEGATED";

export type VerifyResult =
  | { address: string; appKey: string }
  | { refused: SignatureRefusal };

export type Verdict = {
  ok: boolean;
  address: string | null;
  appKey: string | null;
  role: StudioRoleName | null;
  reason: string | null;
  at: string;
};

/** A member's role without team state (org role / ADMINS). */
export interface BaseMember {
  role: StudioRoleName;
  name: string | null;
}

export interface TrustDeps {
  /**
   * The signer's base Studio role (org role / ADMINS only, never team state:
   * team documents are judged against the base role, Ruling C2).
   */
  resolveMember(address: string): Promise<BaseMember | null>;
  checkDelegation: DelegationCheck;
  now(): number;
  /**
   * Local (legacy, unsigned) Studios only: allow the one unsigned operation,
   * index 0 `INIT_TEAM`. Cloud and org Studios pass false.
   */
  allowUnsignedInit?: boolean;
}

export interface TrustLedger {
  judge(documentId: string, op: Operation, required: (member: Member) => boolean): Promise<Verdict>;
  /** Operations with an accepted verdict, in order (never judges). */
  accepted(documentId: string, ops: Operation[], type?: string): Operation[];
  /** Stored verdicts of one document, keyed `<index>:<hash>` (audit). */
  verdicts(documentId: string): Record<string, Verdict>;
}

export class TrustUnavailableError extends Error {
  override name = "TrustUnavailableError";
}

export class TrustStoreError extends Error {
  override name = "TrustStoreError";
}

/** The reactor's verdict shape (its type is not exported from the package root). */
type SignatureVerdict =
  | { ok: true; scheme: string }
  | { ok: false; scheme: string; code: string; reason: string };

/**
 * Verify one operation: a valid v2 signature for exactly this document, then
 * the signer's app-key delegation on Renown. Throws `TrustUnavailableError`
 * when Renown cannot answer; every other failure is a refusal.
 */
export async function verifySignedOperation(
  op: Operation,
  target: OperationTarget,
  checkDelegation: DelegationCheck,
): Promise<VerifyResult> {
  let verdict: SignatureVerdict;
  try {
    verdict = await verifyActionSignature(
      op.action,
      { documentId: target.documentId, branch: target.branch, policy: "v2-required" },
      "mutation",
    );
  } catch {
    return { refused: "BAD_SIGNATURE" };
  }
  if (!verdict.ok) {
    if (verdict.code === "UNSIGNED_REQUIRED" || verdict.code === "UNSIGNED_IDENTITY") {
      return { refused: "UNSIGNED" };
    }
    if (verdict.code === "ID_MISMATCH") return { refused: "WRONG_DOCUMENT" };
    return { refused: "BAD_SIGNATURE" };
  }
  // Only v2: legacy signatures are exactly what P6-2 does not trust.
  if (verdict.scheme !== "v2") return { refused: "BAD_SIGNATURE" };

  const signer = op.action.context?.signer as
    | { user?: { address?: string }; app?: { key?: string }; signatures?: unknown[] }
    | undefined;
  const address = signer?.user?.address?.toLowerCase();
  const appKey = signer?.app?.key;
  if (!address || !appKey || !signer?.signatures?.length) return { refused: "BAD_SIGNATURE" };

  let delegated: boolean;
  try {
    delegated = await checkDelegation(address, appKey);
  } catch (err) {
    throw new TrustUnavailableError(
      `delegation of ${address} cannot be checked: ${err instanceof Error ? err.name : "unknown error"}`,
    );
  }
  if (!delegated) return { refused: "NOT_DELEGATED" };
  return { address, appKey };
}

/** Later tasks append their security-relevant operation types here. */
export const SECURITY_OPERATIONS: Readonly<Record<string, true>> = {
  INIT_TEAM: true,
  SET_REVIEW_REQUIRED: true,
  ADD_REVIEWER: true,
  REMOVE_REVIEWER: true,
  SET_ROLE_OVERRIDE: true,
  CLEAR_ROLE_OVERRIDE: true,
  INVITE_GUEST: true,
  REVOKE_GUEST: true,
  SET_MEMBER_LIMIT: true,
  CLEAR_MEMBER_LIMIT: true,
  START_CHANGE: true,
  OPEN_CHANGE: true,
  REQUEST_LAUNCH: true,
  REQUEST_ROLLBACK: true,
  REQUEST_DISCARD: true,
  REQUEST_REVIEW: true,
  REVIEW_CANDIDATE: true,
  SET_TRIAGE: true,
};

function verdictKey(documentId: string, op: Pick<Operation, "index" | "hash">): string {
  return `${documentId}:${op.index}:${op.hash}`;
}

export function createTrustLedger(workdir: string, deps: TrustDeps): TrustLedger {
  const file = path.join(workdir, TRUST_FILE);
  let store: Record<string, Verdict> = {};
  let corrupt: TrustStoreError | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { verdicts?: unknown };
    if (!parsed || typeof parsed !== "object" || !parsed.verdicts || typeof parsed.verdicts !== "object") {
      throw new Error("missing verdicts map");
    }
    store = parsed.verdicts as Record<string, Verdict>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      corrupt = new TrustStoreError(
        `the team trust ledger is unreadable: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  let queue: Promise<unknown> = Promise.resolve();
  /** One writer at a time; a failed judgement does not poison the queue. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function persist(): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, verdicts: store }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function stored(documentId: string, op: Operation): Verdict | undefined {
    return store[verdictKey(documentId, op)];
  }

  function record(documentId: string, op: Operation, verdict: Verdict): Verdict {
    const key = verdictKey(documentId, op);
    store[key] = verdict;
    try {
      persist();
    } catch (err) {
      // Do not serve a verdict the next process would not see.
      delete store[key];
      throw new TrustStoreError(
        `the team trust ledger could not be written: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
    return verdict;
  }

  return {
    judge(documentId, op, required) {
      return serial(async () => {
        if (corrupt) throw corrupt;
        const existing = stored(documentId, op);
        if (existing) return { ...existing };

        const at = new Date(deps.now()).toISOString();
        const action = op.action;
        const signer = action.context?.signer;
        const unsigned = !signer || (!signer.user && !signer.app && !signer.signatures?.length);
        if (deps.allowUnsignedInit && op.index === 0 && action.type === "INIT_TEAM" && unsigned) {
          // The single legacy exception: a local Studio's INIT_TEAM.
          return record(documentId, op, {
            ok: true,
            address: null,
            appKey: null,
            role: null,
            reason: null,
            at,
          });
        }

        const verified = await verifySignedOperation(
          op,
          { documentId, branch: "main" },
          deps.checkDelegation,
        );
        if ("refused" in verified) {
          return record(documentId, op, {
            ok: false,
            address: null,
            appKey: null,
            role: null,
            reason: verified.refused,
            at,
          });
        }

        let base: BaseMember | null;
        try {
          base = await deps.resolveMember(verified.address);
        } catch (err) {
          throw new TrustUnavailableError(
            `membership of ${verified.address} cannot be checked: ${err instanceof Error ? err.name : "unknown error"}`,
          );
        }
        const member: Member | null = base
          ? { address: verified.address, name: base.name, role: base.role, reviewer: false }
          : null;
        const ok = !!member && required(member);
        return record(documentId, op, {
          ok,
          address: verified.address,
          appKey: verified.appKey,
          role: member?.role ?? null,
          reason: ok ? null : member ? "ROLE" : "NOT_MEMBER",
          at,
        });
      });
    },

    accepted(documentId, ops, type) {
      return ops.filter((op) => {
        if (type !== undefined && op.action.type !== type) return false;
        return stored(documentId, op)?.ok === true;
      });
    },

    verdicts(documentId) {
      const prefix = `${documentId}:`;
      const out: Record<string, Verdict> = {};
      for (const [key, verdict] of Object.entries(store)) {
        if (key.startsWith(prefix)) out[key.slice(prefix.length)] = { ...verdict };
      }
      return out;
    },
  };
}
