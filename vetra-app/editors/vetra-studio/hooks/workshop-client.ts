/**
 * Client for the Studio's workshop routes (owner-only, on the preview
 * server): upload a piece of material, then ask for it to be understood.
 */
import type { UnderstoodDraft } from "../../../shared/understood-draft.js";
import type { Language } from "../i18n/language.js";
import { ownerHeaders, resolvePreviewConfig } from "./preview-server-client.js";

export type MaterialKind = "PICTURE" | "PDF" | "SHEET" | "TEXT";

export type MaterialCard = {
  id: string;
  name: string;
  kind: MaterialKind;
  sheets?: { sheet: string; header: string[]; rowCount: number }[];
};

/** The structured draft the model read out of the material. */
export type { UnderstoodDraft };

export type UnderstandResult = {
  draft: UnderstoodDraft;
  notes: { materialId: string | null; text: string }[];
  costUsd: number;
  ms: number;
};

export type WorkshopErrorCode =
  "too-large" | "unsupported" | "unreadable" | "budget" | "owner" | "network";

export class WorkshopClientError extends Error {
  constructor(
    readonly code: WorkshopErrorCode,
    readonly notes?: { materialId: string | null; text: string }[],
  ) {
    super(code);
    this.name = "WorkshopClientError";
  }
}

function codeFor(status: number): WorkshopErrorCode {
  if (status === 413) return "too-large";
  if (status === 415) return "unsupported";
  if (status === 422) return "unreadable";
  if (status === 402) return "budget";
  if (status === 401 || status === 403) return "owner";
  return "network";
}

async function send(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<Response> {
  let res: Response;
  try {
    const { base } = await resolvePreviewConfig();
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(await ownerHeaders()), ...init.headers },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new WorkshopClientError("network");
  }
  if (res.ok) return res;
  let notes: WorkshopClientError["notes"];
  if (res.status === 422) {
    try {
      notes = ((await res.json()) as { notes?: WorkshopClientError["notes"] })
        .notes;
    } catch {
      notes = undefined;
    }
  }
  throw new WorkshopClientError(codeFor(res.status), notes);
}

export async function uploadMaterial(
  file: File,
  signal?: AbortSignal,
): Promise<MaterialCard> {
  const params = new URLSearchParams({
    name: file.name,
    type: file.type || "application/octet-stream",
  });
  const res = await send(`/workshop/material?${params}`, {
    method: "POST",
    body: file,
    signal,
  });
  return (await res.json()) as MaterialCard;
}

export async function requestUnderstanding(
  input: { materialIds: string[]; text: string; language: Language },
  signal?: AbortSignal,
): Promise<UnderstandResult> {
  const res = await send("/workshop/understand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return (await res.json()) as UnderstandResult;
}

/** An import file the live product can take rows from. */
export type ImportOffer = {
  file: string;
  materialName: string;
  sheet: string;
  documentType: string;
  rows: number;
  mapping: { column: string; field: string }[];
  done: number;
};

/** The import files whose rows are not all in the product yet. */
export async function listImports(): Promise<ImportOffer[]> {
  const res = await send("/workshop/imports", { method: "GET" });
  return (await res.json()) as ImportOffer[];
}

/** Copies the file's missing rows into the live product. */
export async function runImport(
  file: string,
): Promise<{ imported: number; failed: number }> {
  const res = await send("/workshop/imports/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file }),
  });
  return (await res.json()) as { imported: number; failed: number };
}

/** Uploads one preview snapshot (JPEG) of a change's build. */
export async function uploadSnapshot(
  changeId: string,
  at: string,
  blob: Blob,
): Promise<void> {
  const params = new URLSearchParams({ changeId, at });
  await send(`/workshop/snapshots?${params}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
}
