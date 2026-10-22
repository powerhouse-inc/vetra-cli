/**
 * Read and write the Studio's `vetra/studio-product` document — the single
 * read model the Studio page renders from.
 *
 * The document lives in the Studio drive (the embedded reactor's personal
 * drive) and is created by the browser under the legacy signature policy
 * (Ruling R17), so the agent writes it unsigned like the other Studio-drive
 * documents. Reads and writes only happen when a reactor is already running
 * (`getEmbeddedDrive`): one-shot CLI runs never boot one just for this.
 *
 * In an org Studio the writes for a change are the change owner's own work
 * (P6-4, task 1.11): they are v2-signed with that member's delegation, and a
 * change whose owner was removed (or never allowed the agent) is refused
 * rather than written under someone else's name.
 */
import type { Action } from "document-model";
import type { ISigner } from "@powerhousedao/shared/document-model";
import { StudioProductV1 } from "vetra-app/document-models";
import type {
  Change,
  ChangeStatus,
  StudioProductState,
} from "vetra-app/document-models/studio-product";

import { productLocation, type ProductContext } from "./product-location.js";
import { changeAccess, type ChangeOwnerContext } from "../team/change-owner.js";

export {
  STUDIO_PRODUCT_TYPE,
  readProductOperations,
  type ProductClient,
  type ProductContext,
} from "./product-location.js";

/** The model's action creators (the narrow export keeps hooks out of the CLI). */
export const productActions = StudioProductV1.actions;

/** Change statuses that can still be worked on (mirrors the reducer). */
export const IN_PROGRESS: readonly ChangeStatus[] = [
  "BUILDING",
  "PAUSED",
  "READY",
  "LAUNCHING",
];

/** The agent may not write a change its owner can no longer sign for. */
export class ChangeAccessError extends Error {
  override name = "ChangeAccessError";
  constructor(
    message: string,
    /** True when the owner is no longer a member (the change must pause). */
    readonly removed: boolean,
    readonly owner: { address: string; name: string | null } | null,
  ) {
    super(message);
  }
}

/** The reducer refused an operation; `message` is the reducer's own message. */
export class ProductRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductRefusedError";
  }
}

interface DocumentLike {
  state?: { global?: StudioProductState };
}

/** The Studio's product document, or null when there is none (yet). */
export async function getProductDoc(
  ctx: ProductContext,
): Promise<{ id: string; state: StudioProductState } | null> {
  const location = await productLocation(ctx);
  if (!location) return null;
  const doc = (await location.client.get(location.id)) as DocumentLike;
  const state = doc?.state?.global;
  return state ? { id: location.id, state } : null;
}

/**
 * The first reducer refusal `actions` would meet on `doc`, or null. Runs the
 * model's own reducer on a copy, so a refusal is reported with the reducer's
 * message without an errored operation being written to the document.
 */
function dryRun(doc: unknown, actions: Action[]): string | null {
  let current = {
    ...(structuredClone(doc) as object),
    operations: { global: [], local: [] },
  } as unknown as Parameters<typeof StudioProductV1.reducer>[0];
  for (const action of actions) {
    current = StudioProductV1.reducer(current, action);
    const ops = Object.values(current.operations).flat();
    const error = ops[ops.length - 1]?.error;
    if (error) return error;
  }
  return null;
}

/** The change the agent is working on, when there is one. */
export function activeChange(state: StudioProductState): Change | null {
  if (!state.activeChangeId) return null;
  return state.changes.find((c) => c.id === state.activeChangeId) ?? null;
}

/** The command contexts that carry a Studio's own configuration. */
type OrgProductContext = ProductContext & Pick<ChangeOwnerContext, "workdir" | "config">;

/** The caller's context when it can make an org-Studio signing decision. */
function signingContext(ctx: ProductContext): OrgProductContext | null {
  const candidate = ctx as Partial<OrgProductContext>;
  if (!candidate.workdir || !candidate.config?.studioOrgId) return null;
  return candidate as OrgProductContext;
}

/**
 * Who signs an org Studio's writes for `change`: the change owner's own
 * delegation. Throws `ChangeAccessError` when the owner is out (removed) or has
 * not allowed the agent — never falls back to another identity. A change with
 * no accepted start operation (legacy, pre-P6) keeps the unsigned write.
 */
async function signerFor(ctx: ProductContext, change: Change) {
  const signing = signingContext(ctx);
  if (!signing) return null;
  const access = await changeAccess(
    {
      workdir: signing.workdir,
      config: signing.config,
      reactor: ctx.reactor,
      folders: ctx.folders,
      log: ctx.log,
      ownerDeps: ctx.changeOwnerDeps,
    },
    change,
  );
  if (access.kind === "ok") return access.signer;
  if (access.kind === "no-owner") {
    ctx.log?.warn?.(
      `[product] change ${change.id} has no accepted start; writing it unsigned (legacy change)`,
    );
    return null;
  }
  const name = access.owner.name?.trim() || access.owner.address;
  throw new ChangeAccessError(
    access.kind === "removed"
      ? `${name} no longer has access to this Studio.`
      : `${name} has not allowed the Studio's agent to work for them.`,
    access.kind === "removed",
    access.owner,
  );
}

/** Sign `actions` with `signer` for the document snapshot (v2 policy). */
async function signActions(
  actions: Action[],
  snapshot: unknown,
  signer: ISigner,
): Promise<Action[]> {
  const { prepareSignedActions } = await import("@powerhousedao/reactor-browser");
  return prepareSignedActions(
    actions,
    snapshot as Parameters<typeof prepareSignedActions>[1],
    signer,
    StudioProductV1,
  );
}

/**
 * Apply `actions` to the product document. Throws `ProductRefusedError` with
 * the reducer's message (and writes nothing) when the reducer would refuse one
 * of them, a plain Error when there is no product document to write to, and
 * `ChangeAccessError` when an org Studio's change can no longer be signed.
 */
export async function dispatchProduct(
  ctx: ProductContext,
  actions: Action[],
): Promise<void> {
  const location = await productLocation(ctx);
  if (!location) throw new Error("There is no product document in this Studio.");
  const doc = await location.client.get(location.id);
  const refusal = dryRun(doc, actions);
  if (refusal) throw new ProductRefusedError(refusal);
  const state = (doc as DocumentLike)?.state?.global;
  const change = state ? activeChange(state) : null;
  const signer = change ? await signerFor(ctx, change) : null;
  const toWrite = signer ? await signActions(actions, doc, signer) : actions;
  await location.client.execute(location.id, "main", toWrite);
}
