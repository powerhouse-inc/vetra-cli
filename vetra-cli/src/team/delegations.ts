/**
 * Per-member delegations (P6-4, task 1.11): each admitted member allows the
 * Studio's agent to act as them, and the agent stores that member's Renown
 * credential under their own address — one file per member, all for the same
 * agent key (`.ph/.keypair.json`).
 *
 * This is the team-facing view of what `auth/renown.ts` stores: it is what
 * `allowAgent` (self only) writes, what the trust ledger's signature check
 * needs, and what `signerForChange` reads. Removal drops the member's file, so
 * nothing can be signed with their delegation afterwards.
 */
import { existsSync } from "node:fs";
import type { IRenown, ISigner } from "@renown/sdk/node";

import {
  DELEGATIONS_DIR,
  delegationFile,
  forgetMemberRenown,
  getMemberRenown,
  storedDelegations,
} from "../auth/renown.js";

export { DELEGATIONS_DIR, delegationFile, storedDelegations };

/** Whether `address` has allowed the agent (their delegation is on disk). */
export function hasDelegation(workdir: string, address: string): boolean {
  if (!address.trim()) return false;
  return existsSync(delegationFile(workdir, address));
}

/** The member's Renown identity (their credential to the agent's key). */
export async function memberRenown(
  workdir: string,
  renownUrl: string,
  address: string,
): Promise<IRenown> {
  return getMemberRenown(workdir, renownUrl, address);
}

/** The member's signer, or null when they never allowed the agent (or their
 * stored credential no longer loads). */
export async function getMemberSigner(
  workdir: string,
  renownUrl: string,
  address: string,
): Promise<ISigner | null> {
  const renown = await memberRenown(workdir, renownUrl, address);
  return renown.user ? renown.signer : null;
}

/** Forget a member's delegation: used when they are removed from the Studio,
 * so the agent can never sign another operation with it. */
export function dropDelegation(workdir: string, address: string): void {
  forgetMemberRenown(workdir, address);
}
