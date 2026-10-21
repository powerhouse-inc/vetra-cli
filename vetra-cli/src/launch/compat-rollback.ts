/**
 * The data-compatibility check at Go back (spec §6.5, designer's call D6).
 *
 * Going back from the live version to Version m is offered only when no
 * document in the product drive uses something Version m doesn't know: a
 * document type, or an operation type, added after it. The scope is that
 * drive's documents only (§6.7), read once from the live server: the drive's
 * documents and the distinct operation types in each one's history. Fields
 * added after m don't block (documents keep their values; m's code ignores
 * them).
 *
 * Nothing here writes to the product drive: the read is `listDocuments` and
 * `operationTypes` only. Rollback never rewrites or deletes documents.
 */
import { CLOUD_BASE_DOMAIN } from "@powerhousedao/vetra-cloud-client";
import type { StudioProductState, Version } from "vetra-app/document-models/studio-product";
import {
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "../product/product-doc.js";
import { readModelSpecs, type ModelSpec } from "./compat-launch.js";
import {
  switchboardGraphqlEndpoint,
  createDriveClient,
  type ProductDriveClient,
  type ProductDriveContext,
} from "./product-drive.js";

/* ------------------------------------------------------------------------ */
/* Words and bounds                                                          */
/* ------------------------------------------------------------------------ */

/**
 * The row's sentence when the data can't go back (spec §5.7, word for word).
 * The Versions panel reads k back out of it ("Version <k> added data…").
 */
export function rollbackBlockedReason(k: number | null): string {
  const who = k === null ? "A later version" : `Version ${k}`;
  return `Can't go back automatically: ${who} added data your users have already used. Ask the agent to undo the change instead.`;
}

/** Plain reason when the check couldn't run (Go back fails closed; trying again runs it again). */
export function rollbackUncheckedReason(m: number): string {
  return `we couldn't check that your users' data can go back to Version ${m} — try again in a moment`;
}

/** The read stops (and the check fails closed) past this many documents… */
export const USED_MAX_DOCUMENTS = 1_000;
/** …or past this many operations in one document. */
export const USED_MAX_OPERATIONS = 10_000;

/**
 * Operations every document has whatever its model (document-model base
 * actions): never something a version added.
 */
const BASE_OPERATIONS = new Set([
  "SET_NAME",
  "UNDO",
  "REDO",
  "PRUNE",
  "LOAD_STATE",
  "NOOP",
  "CREATE_DOCUMENT",
  "DELETE_DOCUMENT",
  "UPGRADE_DOCUMENT",
  "ADD_RELATIONSHIP",
  "REMOVE_RELATIONSHIP",
]);

/* ------------------------------------------------------------------------ */
/* What the drive uses                                                       */
/* ------------------------------------------------------------------------ */

export interface UsedData {
  /** Document types of the drive's documents. */
  documentTypes: Set<string>;
  /** Per document type, the operation types its documents' histories hold. */
  operationTypes: Map<string, Set<string>>;
  /** How many documents were read. */
  documents: number;
}

async function readClient(ctx: ProductDriveContext, switchboardUrl: string): Promise<ProductDriveClient> {
  const endpoint = switchboardGraphqlEndpoint(switchboardUrl);
  return ctx.driveClient ? ctx.driveClient(endpoint) : createDriveClient(ctx, endpoint);
}

/**
 * One bounded read of the product drive on the live server: its documents
 * and the operation types each one used. Throws when the drive can't be read
 * or holds more than the bounds allow (the caller fails closed).
 */
export async function usedInDrive(
  ctx: ProductDriveContext,
  switchboardUrl: string,
  driveId: string,
): Promise<UsedData> {
  const client = await readClient(ctx, switchboardUrl);
  const readOps = client.operationTypes?.bind(client);
  if (!readOps) throw new Error("This server client can't read operation histories.");
  const documents = await client.listDocuments(driveId);
  if (documents.length > USED_MAX_DOCUMENTS) {
    throw new Error(`The product drive holds more than ${USED_MAX_DOCUMENTS} documents.`);
  }
  const documentTypes = new Set<string>();
  const operationTypes = new Map<string, Set<string>>();
  for (const doc of documents) {
    documentTypes.add(doc.documentType);
    const types = await readOps(doc.id, USED_MAX_OPERATIONS);
    const set = operationTypes.get(doc.documentType) ?? new Set<string>();
    for (const t of types) set.add(t);
    operationTypes.set(doc.documentType, set);
  }
  return { documentTypes, operationTypes, documents: documents.length };
}

/* ------------------------------------------------------------------------ */
/* Can the data go back?                                                     */
/* ------------------------------------------------------------------------ */

/** The models of a version launched after the target. */
export interface LaterModels {
  number: number;
  specs: ModelSpec[];
}

export type GoBackCheck =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /** The earliest later version that added something in use; null when unknown. */
      addedIn: number | null;
      /** What is in use that the target doesn't know (for logs). */
      what: string[];
    };

function hasModel(specs: ModelSpec[], documentType: string): boolean {
  return specs.some((s) => s.documentType === documentType);
}

function hasOperation(specs: ModelSpec[], documentType: string, op: string): boolean {
  return specs.some((s) => s.documentType === documentType && s.operations.some((o) => o.name === op));
}

/**
 * Whether the drive's data can live with the target version's models.
 *
 * Something in use that the target doesn't know blocks going back when a
 * version launched after the target added it (`later`); k is the earliest
 * such version. Without `later`, anything the target doesn't know blocks
 * (k unknown). Base document operations never block; neither does anything
 * no version after the target defines (going back doesn't take it away).
 */
export function canGoBack(target: ModelSpec[], used: UsedData, later?: LaterModels[]): GoBackCheck {
  const sorted = later ? [...later].sort((x, y) => x.number - y.number) : null;
  const addedBy = (known: (specs: ModelSpec[]) => boolean): number | null | undefined => {
    if (!sorted) return null;
    return sorted.find((v) => known(v.specs))?.number;
  };
  const found: { what: string; k: number | null }[] = [];
  const types = new Set([...used.documentTypes, ...used.operationTypes.keys()]);
  for (const type of [...types].sort()) {
    if (!hasModel(target, type)) {
      const k = addedBy((specs) => hasModel(specs, type));
      if (k !== undefined) found.push({ what: `documents of type "${type}"`, k });
      continue;
    }
    for (const op of [...(used.operationTypes.get(type) ?? [])].sort()) {
      if (BASE_OPERATIONS.has(op) || hasOperation(target, type, op)) continue;
      const k = addedBy((specs) => hasOperation(specs, type, op));
      if (k !== undefined) found.push({ what: `operation "${op}" on "${type}"`, k });
    }
  }
  if (found.length === 0) return { ok: true };
  const ks = found.map((f) => f.k).filter((k): k is number => k !== null);
  const addedIn = ks.length ? Math.min(...ks) : null;
  return { ok: false, reason: rollbackBlockedReason(addedIn), addedIn, what: found.map((f) => f.what) };
}

/* ------------------------------------------------------------------------ */
/* Checking a product's versions                                             */
/* ------------------------------------------------------------------------ */

/** The product's live server (`<slug>-switchboard.vetra.io`, as the orchestrator has it). */
function switchboardOf(slug: string): string {
  return `https://${slug}-switchboard.${CLOUD_BASE_DOMAIN}`;
}

/** Versions that went live (LIVE or PREVIOUS): the ones whose models data may have used. */
function launched(state: StudioProductState): Version[] {
  return state.versions.filter((v) => v.status === "LIVE" || v.status === "PREVIOUS");
}

export interface CompatRollbackDeps {
  usedInDrive: typeof usedInDrive;
  readModelSpecs: typeof readModelSpecs;
}

export interface CompatRollbackContext extends ProductContext, ProductDriveContext {
  workdir: string;
  log?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
  /** Seams for tests. */
  compatDeps?: Partial<CompatRollbackDeps>;
}

function depsOf(ctx: CompatRollbackContext): CompatRollbackDeps {
  return { usedInDrive, readModelSpecs, ...ctx.compatDeps };
}

/** What the live drive uses; an empty set when there is no product drive yet. */
export async function readUsed(ctx: CompatRollbackContext, state: StudioProductState): Promise<UsedData> {
  const driveId = state.productDriveId;
  if (!driveId) return { documentTypes: new Set(), operationTypes: new Map(), documents: 0 };
  if (!state.slug) throw new Error("The product has a drive but no live address.");
  return depsOf(ctx).usedInDrive(ctx, switchboardOf(state.slug), driveId);
}

/** Version m's models and those of every version launched after it, read from git. */
export async function checkVersion(
  ctx: CompatRollbackContext,
  state: StudioProductState,
  m: number,
  used: UsedData,
  cache = new Map<string, Promise<ModelSpec[]>>(),
): Promise<GoBackCheck> {
  if (used.documents === 0) return { ok: true };
  const read = (tag: string) => {
    let specs = cache.get(tag);
    if (!specs) {
      specs = depsOf(ctx).readModelSpecs(ctx.workdir, tag);
      cache.set(tag, specs);
    }
    return specs;
  };
  const target = state.versions.find((v) => v.number === m);
  if (!target?.gitTag) throw new Error(`Version ${m} has no saved code.`);
  const after = launched(state).filter((v) => v.number > m);
  // A later version without saved code could have added anything: fail closed.
  const unsaved = after.find((v) => !v.gitTag);
  if (unsaved) throw new Error(`Version ${unsaved.number} has no saved code.`);
  const later = await Promise.all(after.map(async (v) => ({ number: v.number, specs: await read(v.gitTag) })));
  return canGoBack(await read(target.gitTag), used, later);
}

/**
 * F26: write ahead of time which earlier versions the data can't go back to,
 * so a blocked one never shows a plain Go back. For every version that was
 * live before (not the live one) and isn't blocked yet, runs the check and
 * records `SET_ROLLBACK_BLOCK` when it is now blocked. A block never lifts by
 * itself (the data that caused it stays), and when every such version is
 * already blocked the drive isn't read. When the drive can't be read nothing
 * is changed. Never throws; returns how many versions changed.
 */
export async function refreshRollbackBlocks(ctx: CompatRollbackContext): Promise<number> {
  try {
    const state = (await getProductDoc(ctx))?.state;
    if (!state || state.liveVersion == null) return 0;
    const candidates = state.versions.filter(
      (v) => v.status === "PREVIOUS" && v.deploymentId && !v.rollbackBlockedReason,
    );
    if (candidates.length === 0) return 0;
    let used: UsedData;
    try {
      used = await readUsed(ctx, state);
    } catch (err) {
      ctx.log?.warn?.(`[go back] which versions the data can go back to wasn't checked: ${message(err)}`);
      return 0;
    }
    const cache = new Map<string, Promise<ModelSpec[]>>();
    const actions = [];
    for (const v of candidates) {
      try {
        const check = await checkVersion(ctx, state, v.number, used, cache);
        if (check.ok) continue;
        ctx.log?.info?.(`[go back] Version ${v.number} blocked: ${check.what.join("; ")}`);
        actions.push(a.setRollbackBlock({ number: v.number, reason: check.reason }));
      } catch (err) {
        ctx.log?.warn?.(`[go back] Version ${v.number} not checked: ${message(err)}`);
      }
    }
    if (actions.length) await dispatchProduct(ctx, actions);
    return actions.length;
  } catch (err) {
    ctx.log?.warn?.(`[go back] blocked versions not refreshed: ${message(err)}`);
    return 0;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
