/**
 * Read and write the Studio's `vetra/studio-product` document — the single
 * read model the Studio page renders from.
 *
 * The document lives in the Studio drive (the embedded reactor's personal
 * drive) and is created by the browser under the legacy signature policy
 * (Ruling R17), so the agent writes it unsigned like the other Studio-drive
 * documents. Reads and writes only happen when a reactor is already running
 * (`getEmbeddedDrive`): one-shot CLI runs never boot one just for this.
 */
import type { Action } from "document-model";
import { StudioProductV1 } from "vetra-app/document-models";
import type {
  Change,
  ChangeStatus,
  StudioProductState,
} from "vetra-app/document-models/studio-product";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";

export const STUDIO_PRODUCT_TYPE = "vetra/studio-product";

/** The model's action creators (the narrow export keeps hooks out of the CLI). */
export const productActions = StudioProductV1.actions;

/** Change statuses that can still be worked on (mirrors the reducer). */
export const IN_PROGRESS: readonly ChangeStatus[] = [
  "BUILDING",
  "PAUSED",
  "READY",
  "LAUNCHING",
];

/** The minimal reactor client surface the product helpers use. */
export interface ProductClient {
  get(documentId: string): Promise<unknown>;
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
}

/** Structural view of the command context these helpers read. */
export interface ProductContext {
  folders?: unknown;
  reactor?: () => Promise<
    { client: unknown; personalDriveId?: string; driveId?: string } | undefined
  >;
  log?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
}

/** The reducer refused an operation; `message` is the reducer's own message. */
export class ProductRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductRefusedError";
  }
}

interface DriveNode {
  id: string;
  kind: string;
  documentType?: string;
}

interface DocumentLike {
  state?: { global?: StudioProductState };
}

async function productLocation(
  ctx: ProductContext,
): Promise<{ client: ProductClient; driveId: string; id: string } | null> {
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return null;
  const client = drive.reactor.client as unknown as ProductClient;
  const driveDoc = (await client.get(drive.driveId)) as {
    state?: { global?: { nodes?: DriveNode[] } };
  };
  const node = (driveDoc?.state?.global?.nodes ?? []).find(
    (n) => n.kind === "file" && n.documentType === STUDIO_PRODUCT_TYPE,
  );
  return node ? { client, driveId: drive.driveId, id: node.id } : null;
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

/**
 * Apply `actions` to the product document. Throws `ProductRefusedError` with
 * the reducer's message (and writes nothing) when the reducer would refuse one
 * of them, and a plain Error when there is no product document to write to.
 */
export async function dispatchProduct(
  ctx: ProductContext,
  actions: Action[],
): Promise<void> {
  const location = await productLocation(ctx);
  if (!location) throw new Error("There is no product document in this Studio.");
  const refusal = dryRun(await location.client.get(location.id), actions);
  if (refusal) throw new ProductRefusedError(refusal);
  await location.client.execute(location.id, "main", actions);
}

/** The change the agent is working on, when there is one. */
export function activeChange(state: StudioProductState): Change | null {
  if (!state.activeChangeId) return null;
  return state.changes.find((c) => c.id === state.activeChangeId) ?? null;
}
