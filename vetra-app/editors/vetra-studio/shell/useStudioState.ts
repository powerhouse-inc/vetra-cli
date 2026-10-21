/**
 * Which of the Studio page's states to show (spec §5.3–§5.6, ruling F4):
 * - `legacy`: an older Studio — no product document, but conversations or
 *   project documents — keeps today's view until it is converted (Task 3.7);
 * - `idea`: no product yet, or one whose first start isn't complete;
 * - `building`: a product that isn't live yet;
 * - `live`: a product with a live version.
 *
 * The idea/started split reuses the idea-start rules of `startProduct`
 * (productStarted, ideaStartStatus), so the shell and a start that stopped
 * half-way agree on when the idea screen is still the right one.
 */
import type { PHDocument } from "document-model";
import {
  normalizeProduct,
  studioProductDocumentType,
  type StudioProductDocument,
  type StudioProductState,
} from "document-models/studio-product";
import { useMemo } from "react";
import { useDriveDocuments } from "../hooks/useDriveDocuments.js";
import {
  findProductNode,
  ideaStartStatus,
  type StartProductDrive,
} from "../idea/startProduct.js";

export type StudioState = "legacy" | "idea" | "building" | "live";

/** A normalised copy of the product state; the document stays untouched
 *  (normalizeProduct fills in place). */
export function readProduct(state: StudioProductState): StudioProductState {
  return normalizeProduct(structuredClone(state));
}

/**
 * The page state for a drive. `product` is the drive's product state (null
 * when there is none or it isn't loaded); `documents` are the drive's loaded
 * documents (the conversations decide whether the first start is complete).
 */
export function studioState(
  product: StudioProductState | null,
  drive: StartProductDrive,
  documents: readonly PHDocument[] = [],
): StudioState {
  const start = ideaStartStatus(drive, documents);
  if (start === "legacy") return "legacy";
  if (start === "idea") return "idea";
  if (product && product.changes.length === 0) return "idea";
  if (product?.liveVersion != null) return "live";
  return "building";
}

/** The drive's product document among its loaded documents. */
export function findProductDocument(
  drive: StartProductDrive,
  documents: readonly PHDocument[],
): PHDocument | undefined {
  const node = findProductNode(drive);
  return node ? documents.find((d) => d.header.id === node.id) : undefined;
}

/** By type only: an older product document may not pass today's schema;
 *  readProduct fills in what it lacks. */
function isProductDocument(doc: PHDocument): doc is StudioProductDocument {
  return doc.header.documentType === studioProductDocumentType;
}

export type StudioStateResult =
  | { status: "loading" }
  | {
      status: StudioState;
      /** Normalised copy of the product state, null when not readable. */
      product: StudioProductState | null;
      productId: string | null;
      documents: PHDocument[];
    };

/** The page state for the selected drive; `loading` until it hydrates. */
export function useStudioState(drive: StartProductDrive): StudioStateResult {
  const documents = useDriveDocuments();
  const productDoc = documents
    ? findProductDocument(drive, documents)
    : undefined;
  const product = useMemo(
    () =>
      productDoc && isProductDocument(productDoc)
        ? readProduct(productDoc.state.global)
        : null,
    [productDoc],
  );
  if (!documents) return { status: "loading" };
  return {
    status: studioState(product, drive, documents),
    product,
    productId: findProductNode(drive)?.id ?? null,
    documents,
  };
}
