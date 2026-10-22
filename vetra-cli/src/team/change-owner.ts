/**
 * Whose change is it, and whose delegation does the agent use for it (P6-4,
 * task 1.11)? The owner is the accepted signer of the change's `START_CHANGE`
 * (or `OPEN_CHANGE`) in the trust ledger — the browser's own signed operation,
 * verified against the signer's base role, never a name in a request body.
 *
 * `signerForChange` is the only way the agent gets an identity for a change:
 * the owner's own delegation (one file per member, team/delegations.ts). When
 * the owner is gone the change can no longer be worked on; a caller pauses it
 * rather than signing one more operation for them.
 */
import type { ISigner } from "@powerhousedao/shared/document-model";
import type { Change } from "vetra-app/document-models/studio-product";

import {
  getMemberSigner,
  dropDelegation as dropStoredDelegation,
  storedDelegations,
} from "./delegations.js";
import { isAdminAddress } from "../auth/renown.js";
import { createDelegationCheck } from "./delegation-check.js";
import { fetchOrgMembership } from "./renown-orgs.js";
import { CAPABILITIES, mapOrgRole, publisherCapable, type Member, type StudioRoleName } from "./roles.js";
import { createTrustLedger, type BaseMember, type Operation, type TrustLedger } from "./trust.js";
import { readProductOperations, type ProductContext } from "../product/product-location.js";
import type { Config } from "../framework.js";

/** The operations that open a change (`OPEN_CHANGE` arrives with M2). */
export const CHANGE_START_TYPES: Readonly<Record<string, true>> = {
  START_CHANGE: true,
  OPEN_CHANGE: true,
};

/** The operation types that say a change reached READY (a launch request too). */
export const CHANGE_REQUEST_TYPES: Readonly<Record<string, true>> = {
  REQUEST_LAUNCH: true,
  REQUEST_ROLLBACK: true,
  REQUEST_DISCARD: true,
  REQUEST_REVIEW: true,
};

export interface ChangeOwner {
  address: string;
  name: string | null;
}

export type ChangeAccess =
  /** No accepted start operation: a legacy (pre-P6) change, nothing to follow. */
  | { kind: "no-owner" }
  | { kind: "ok"; owner: ChangeOwner; signer: ISigner }
  /** The owner is no longer a member: their delegation was dropped. */
  | { kind: "removed"; owner: ChangeOwner }
  /** A member who never allowed the agent (or dropped it themselves). */
  | { kind: "no-delegation"; owner: ChangeOwner };

export interface ChangeDocument {
  documentId: string;
  operations: Operation[];
}

export interface ChangeOwnerDeps {
  /** The product document and its global operations. */
  readProduct(): Promise<ChangeDocument | null>;
  ledger: TrustLedger;
  /** The member behind `address` today, null when they are not one. */
  member(address: string): Promise<(Member & { role: StudioRoleName }) | null>;
  /** The member's own delegation; null when they never allowed the agent. */
  signer(address: string): Promise<ISigner | null>;
  /** Called when a removed member's delegation is dropped. */
  dropDelegation(address: string): void;
}

const isChangeStart = (op: Operation) => CHANGE_START_TYPES[op.action.type] === true;
/** Owners and Makers open a change (the same rule the routes use). */
const startsChange = (member: Member) => CAPABILITIES.startChange(member, {});

function changeIdOf(op: Operation): string | null {
  const input = op.action.input as { id?: unknown; changeId?: unknown } | undefined;
  const id = input?.id ?? input?.changeId;
  return typeof id === "string" ? id : null;
}

export interface ChangeOwnerSource {
  changeOwner(change: Pick<Change, "id">): Promise<ChangeOwner | null>;
  signerForChange(change: Pick<Change, "id">): Promise<ISigner | null>;
  changeAccess(change: Pick<Change, "id">): Promise<ChangeAccess>;
}

export function createChangeOwnerSource(deps: ChangeOwnerDeps): ChangeOwnerSource {
  /** The product document's start operation for `change`, judged once. */
  async function ownerOf(change: Pick<Change, "id">): Promise<ChangeOwner | null> {
    const product = await deps.readProduct();
    if (!product) return null;
    const starts = product.operations.filter(
      (op) => isChangeStart(op) && changeIdOf(op) === change.id,
    );
    if (starts.length === 0) return null;
    for (const op of starts) await deps.ledger.judge(product.documentId, op, startsChange);
    const accepted = deps.ledger.accepted(product.documentId, starts);
    const last = accepted[accepted.length - 1];
    if (!last) return null;
    const verdict = deps.ledger.verdicts(product.documentId)[`${last.index}:${last.hash}`];
    if (!verdict?.address) return null;
    const member = await deps.member(verdict.address);
    return { address: verdict.address, name: member?.name ?? null };
  }

  async function changeAccess(change: Pick<Change, "id">): Promise<ChangeAccess> {
    const owner = await ownerOf(change);
    if (!owner) return { kind: "no-owner" };
    const member = await deps.member(owner.address);
    if (!member) {
      // Nothing more is ever signed for someone who is out: drop the stored
      // delegation, so a later re-invite starts from a fresh, explicit allow.
      deps.dropDelegation(owner.address);
      return { kind: "removed", owner: { ...owner, name: owner.name ?? null } };
    }
    const signer = await deps.signer(owner.address);
    if (!signer) return { kind: "no-delegation", owner: { ...owner, name: owner.name ?? member.name } };
    return { kind: "ok", owner: { ...owner, name: owner.name ?? member.name }, signer };
  }

  return {
    changeOwner: ownerOf,
    async signerForChange(change) {
      const access = await changeAccess(change);
      return access.kind === "ok" ? access.signer : null;
    },
    changeAccess,
  };
}

/* ------------------------------------------------------------------------ */
/* Production wiring                                                         */
/* ------------------------------------------------------------------------ */

/** The command context a change-owner decision needs (the agent's process). */
export interface ChangeOwnerContext {
  workdir: string;
  config: Pick<Config, "studioOrgId" | "environmentId" | "cloudRenownUrl" | "renownOrgsUrl">;
  /** The reactor accessors the product document is read through. */
  reactor?: ProductContext["reactor"];
  folders?: unknown;
  log?: { warn?: (msg: string) => void };
  /** Seams for tests (a scripted product document, ledger, members, signers). */
  ownerDeps?: Partial<ChangeOwnerDeps>;
}

const sources = new Map<string, ChangeOwnerSource>();

/** How long a base role is trusted between product writes (as membership). */
const BASE_ROLE_TTL_MS = 60_000;

/** The org role only (Ruling C2: never team state), caching admitted members
 * briefly: a product write asks on every dispatch, and a removal only has to
 * land within the membership TTL the routes already use. A refusal (or a
 * failure) is never cached, so a just-invited member is admitted at once. */
function baseResolver(ctx: ChangeOwnerContext): (address: string) => Promise<BaseMember | null> {
  const orgId = ctx.config.studioOrgId?.trim() || null;
  const cache = new Map<string, { member: BaseMember | null; until: number }>();
  return async (address) => {
    const key = address.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.member;
    const member = await resolveUncached(key);
    if (member) cache.set(key, { member, until: Date.now() + BASE_ROLE_TTL_MS });
    return member;
  };

  async function resolveUncached(address: string): Promise<BaseMember | null> {
    if (!orgId) {
      return isAdminAddress(address, process.env.ADMINS) ? { role: "owner", name: null } : null;
    }
    const url = ctx.config.renownOrgsUrl?.trim();
    if (!url) throw new Error("VETRA_RENOWN_ORGS_URL is not configured");
    const membership = await fetchOrgMembership(url, orgId, address);
    if (!membership) return null;
    // C17: without the Studio App's DID every PUBLISHER counts as a maker.
    const role = mapOrgRole({
      role: membership.role,
      status: membership.status,
      publisherCapable: publisherCapable(membership, null),
    });
    return role ? { role, name: null } : null;
  }
}

function defaultSource(ctx: ChangeOwnerContext): ChangeOwnerSource {
  const key = ctx.workdir;
  let source = sources.get(key);
  if (source) return source;
  const resolveMember = baseResolver(ctx);
  const renownUrl = ctx.config.cloudRenownUrl ?? "";
  const deps: ChangeOwnerDeps = {
    readProduct: () => readProductOperations({ reactor: ctx.reactor, folders: ctx.folders }),
    ledger: createTrustLedger(ctx.workdir, {
      resolveMember,
      checkDelegation: createDelegationCheck({ renownUrl: renownUrl || undefined }),
      now: Date.now,
    }),
    async member(address) {
      const base = await resolveMember(address);
      return base ? { address, name: base.name, role: base.role, reviewer: false } : null;
    },
    signer: (address) => getMemberSigner(ctx.workdir, renownUrl, address),
    dropDelegation: (address) => dropStoredDelegation(ctx.workdir, address),
    ...ctx.ownerDeps,
  };
  source = createChangeOwnerSource(deps);
  sources.set(key, source);
  return source;
}

function sourceFor(ctx: ChangeOwnerContext): ChangeOwnerSource {
  if (!ctx.ownerDeps) return defaultSource(ctx);
  return createChangeOwnerSource({
    readProduct: async () => null,
    ledger: createTrustLedger(ctx.workdir, {
      resolveMember: async () => null,
      checkDelegation: async () => false,
      now: Date.now,
    }),
    member: async () => null,
    signer: async () => null,
    dropDelegation: () => {},
    ...ctx.ownerDeps,
  });
}

/** The accepted signer of the change's start operation, or null. */
export function changeOwner(
  ctx: ChangeOwnerContext,
  change: Pick<Change, "id">,
): Promise<ChangeOwner | null> {
  return sourceFor(ctx).changeOwner(change);
}

/** The delegation the agent signs the change's operations with (null: none). */
export function signerForChange(
  ctx: ChangeOwnerContext,
  change: Pick<Change, "id">,
): Promise<ISigner | null> {
  return sourceFor(ctx).signerForChange(change);
}

/** Everything the pause path needs to decide (owner, removed, no delegation). */
export function changeAccess(
  ctx: ChangeOwnerContext,
  change: Pick<Change, "id">,
): Promise<ChangeAccess> {
  return sourceFor(ctx).changeAccess(change);
}

/**
 * A signer for Studio-level writes that belong to no change (the access pause,
 * which cannot be signed by the member being removed): the first stored
 * delegation whose member is still admitted. Null when there is none.
 */
export async function studioMemberSigner(ctx: ChangeOwnerContext): Promise<ISigner | null> {
  const resolveMember = baseResolver(ctx);
  const renownUrl = ctx.config.cloudRenownUrl ?? "";
  for (const address of storedDelegations(ctx.workdir)) {
    if (!(await resolveMember(address))) continue;
    const signer = await getMemberSigner(ctx.workdir, renownUrl, address);
    if (signer) return signer;
  }
  return null;
}
