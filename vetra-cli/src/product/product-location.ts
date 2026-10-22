/**
 * Where the Studio's `vetra/studio-product` document lives (its id in the
 * Studio drive) — shared by the product writers (product-doc.ts) and the
 * change-owner reader (team/change-owner.ts), so both find the same document
 * without importing each other.
 */
import type { Action } from "document-model";

import type { Operation } from "../team/trust.js";
import type { ChangeOwnerDeps } from "../team/change-owner.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";

export const STUDIO_PRODUCT_TYPE = "vetra/studio-product";

/** The minimal reactor client surface the product helpers use. */
export interface ProductClient {
  get(documentId: string): Promise<unknown>;
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
  /** The document's operations (trust decisions read the signed start ops). */
  getOperations?(
    documentId: string,
    opts: { branch: string; scopes: ("global" | "local")[] },
  ): Promise<{ results: unknown[] }>;
}

/** Structural view of the command context these helpers read. */
export interface ProductContext {
  folders?: unknown;
  reactor?: () => Promise<
    { client: unknown; personalDriveId?: string; driveId?: string } | undefined
  >;
  /** Seam for tests: script the change owner instead of the trust ledger. */
  changeOwnerDeps?: Partial<ChangeOwnerDeps>;
  log?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
}

interface DriveNode {
  id: string;
  kind: string;
  documentType?: string;
}

export interface ProductLocation {
  client: ProductClient;
  driveId: string;
  id: string;
}

/** The product document's client/id, or null when there is none (yet). */
export async function productLocation(ctx: ProductContext): Promise<ProductLocation | null> {
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

/** The document's global operations (the browser's own signed requests). */
export async function readProductOperations(
  ctx: ProductContext,
): Promise<{ documentId: string; operations: Operation[] } | null> {
  const location = await productLocation(ctx);
  if (!location?.client.getOperations) return null;
  const { results } = await location.client.getOperations(location.id, {
    branch: "main",
    scopes: ["global"],
  });
  return { documentId: location.id, operations: results as Operation[] };
}
