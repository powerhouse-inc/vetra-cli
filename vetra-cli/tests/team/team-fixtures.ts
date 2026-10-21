// Signed operations for the trust tests: a real Renown signer (the Studio
// agent's P-256 app key) and v2 signatures, never a stub signature.
import {
  actionSignerIdentity,
  actionSigningTarget,
  generateId,
  type Action,
  type ISigner,
} from "@powerhousedao/shared/document-model";

import { getRenown } from "../../src/auth/renown.js";
import type { Operation } from "../../src/team/trust.js";

export const OWNER = "0x1111111111111111111111111111111111111111";
export const OTHER = "0x2222222222222222222222222222222222222222";

const AT = (index: number) => `2026-10-21T10:00:${String(index % 60).padStart(2, "0")}.000Z`;

/** The Renown signer in `dir`, acting as `address` (its app key is stable per dir). */
export async function signerFor(dir: string, address: string = OWNER): Promise<ISigner> {
  const renown = await getRenown(dir, "http://127.0.0.1:1");
  renown.signer.user = { address, networkId: "eip155", chainId: 1 };
  return renown.signer;
}

function actionFor(index: number, type: string, input: Record<string, unknown>): Action {
  return {
    id: generateId(),
    type,
    scope: "global",
    timestampUtcMs: AT(index),
    input,
  };
}

/** A v2-signed operation for `documentId`, signed with the signer's app key. */
export async function signedOperation(
  signer: ISigner,
  documentId: string,
  index: number,
  type: string,
  input: Record<string, unknown>,
): Promise<Operation> {
  const action = actionFor(index, type, input);
  const signature = await signer.signAction(action, actionSigningTarget(action, documentId, "main"));
  return {
    id: generateId(),
    index,
    hash: `hash-${index}`,
    timestampUtcMs: action.timestampUtcMs,
    action: {
      ...action,
      context: { ...action.context, signer: { ...actionSignerIdentity(signer), signatures: [signature] } },
    },
  };
}

/** An operation with no signer at all (the legacy local INIT_TEAM exception). */
export function unsignedOperation(
  index: number,
  type: string,
  input: Record<string, unknown>,
): Operation {
  return {
    id: generateId(),
    index,
    hash: `hash-${index}`,
    timestampUtcMs: AT(index),
    action: actionFor(index, type, input),
  };
}
