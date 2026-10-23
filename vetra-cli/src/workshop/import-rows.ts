/**
 * Bringing a sheet's real rows into the live product (Task 1.8).
 *
 * Reads the `import/<slug>.json` files the agent wrote (Task 1.7), offers
 * them once the product is live, and copies each document into the product
 * drive as the owner. Progress is kept per row index in
 * `.ph/vetra/workshop/imports/<slug>.json`, so a failed run resumes at the
 * first missing row and never creates a row twice.
 */
import fs from "node:fs";
import path from "node:path";
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import type { SeedAction } from "../launch/seed.js";
import {
  createDriveClient,
  storedProductDrive,
  switchboardGraphqlEndpoint,
  type ProductDriveClient,
  type ProductDriveContext,
} from "../launch/product-drive.js";
import { resolveReactorProjectPath } from "../helpers/project.js";
import {
  dispatchProduct,
  getProductDoc,
  productActions,
  type ProductContext,
} from "../product/product-doc.js";
import {
  readImports,
  type ImportFile,
  type ImportMapping,
} from "./import-files.js";

export type ImportRowsContext = ProductContext &
  ProductDriveContext & {
    /** Seam for tests; defaults to the delegated-identity drive client. */
    driveClient?: (endpoint: string) => Promise<ProductDriveClient>;
  };

export type ImportOffer = {
  file: string;
  materialName: string;
  sheet: string;
  documentType: string;
  rows: number;
  mapping: ImportMapping[];
  done: number;
};

export type ImportRunResult = { imported: number; failed: number };

/** A run that cannot start, or a row the live product refused. */
export class ImportRowsError extends Error {
  constructor(
    readonly code: "no-drive" | "unknown-file" | "import-failed",
    message: string,
  ) {
    super(message);
    this.name = "ImportRowsError";
  }
}

interface Progress {
  /** The product's row-import id, kept across retries. */
  id: string;
  /** Row indexes already copied into the product. */
  imported: number[];
}

function progressPath(workdir: string, file: string): string {
  return path.join(
    workdir,
    ".ph",
    "vetra",
    "workshop",
    "imports",
    `${path.basename(file, ".json")}.json`,
  );
}

function readProgress(workdir: string, file: string, id: string): Progress {
  try {
    const raw = JSON.parse(
      fs.readFileSync(progressPath(workdir, file), "utf-8"),
    ) as Partial<Progress>;
    return {
      id: typeof raw.id === "string" ? raw.id : id,
      imported: Array.isArray(raw.imported)
        ? raw.imported.filter((n): n is number => Number.isInteger(n))
        : [],
    };
  } catch {
    return { id, imported: [] };
  }
}

function writeProgress(workdir: string, file: string, progress: Progress): void {
  const target = progressPath(workdir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(progress, null, 2)}\n`);
}

/** A stable id for a file's row import (per product). */
function importId(file: string): string {
  return `row-import-${path.basename(file, ".json")}`;
}

function importFiles(projectPath: string, materialNames: Map<string, string>) {
  return readImports(projectPath).flatMap((read) => {
    if (!read.ok) return [];
    return [
      {
        file: read.file,
        value: read.value,
        materialName:
          materialNames.get(read.value.source.materialId) ??
          read.value.source.materialId,
      },
    ];
  });
}

/**
 * The reactor project(s) in the workdir. Normally exactly one. A Studio that
 * rebuilt a product leaves the earlier project next to the new one, so the
 * workdir then holds several — `resolveReactorProjectPath` refuses to pick one.
 * Every project is then read, newest first; each file is still validated
 * against its own project's models, so only real imports survive.
 */
async function liveProjects(ctx: ImportRowsContext): Promise<string[]> {
  try {
    return [await resolveReactorProjectPath(ctx.workdir, undefined)];
  } catch {
    const entries = await fs.promises
      .readdir(ctx.workdir, { withFileTypes: true })
      .catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(ctx.workdir, entry.name))
      .filter((project) =>
        fs.existsSync(path.join(project, "powerhouse.config.json")),
      )
      .sort((a, b) => {
        const at = fs.statSync(a).mtimeMs;
        const bt = fs.statSync(b).mtimeMs;
        return bt - at;
      });
  }
}

function materialNames(state: StudioProductState): Map<string, string> {
  return new Map(
    (state.understood?.materials ?? []).map((m) => [m.id, m.name]),
  );
}

/** The import files the live product can still take rows from. */
export async function listImports(
  ctx: ImportRowsContext,
): Promise<ImportOffer[]> {
  const product = await getProductDoc(ctx);
  if (!product || !product.state.liveUrl) return [];
  const projects = await liveProjects(ctx);
  if (!projects.length) return [];
  const names = materialNames(product.state);
  const seen = new Set<string>();
  const files = projects
    .flatMap((project) => importFiles(project, names))
    .filter(({ file }) => (seen.has(file) ? false : Boolean(seen.add(file))));
  return files.map(({ file, value, materialName }) => ({
    file,
    materialName,
    sheet: value.source.sheet,
    documentType: value.documentType,
    rows: value.documents.length,
    mapping: value.mapping,
    done: readProgress(ctx.workdir, file, importId(file)).imported.length,
  }));
}

async function driveFor(ctx: ImportRowsContext): Promise<{
  client: ProductDriveClient;
  driveId: string;
}> {
  const stored = storedProductDrive(ctx.workdir);
  const product = await getProductDoc(ctx);
  const driveId = product?.state.productDriveId ?? stored?.driveId;
  if (!stored || !driveId) {
    throw new ImportRowsError(
      "no-drive",
      "Your product has no live data space yet.",
    );
  }
  const endpoint = switchboardGraphqlEndpoint(stored.switchboardUrl);
  const client = ctx.driveClient
    ? await ctx.driveClient(endpoint)
    : await createDriveClient(ctx, endpoint);
  return { client, driveId };
}

async function startImport(
  ctx: ImportRowsContext,
  state: StudioProductState,
  file: ImportFile,
  id: string,
): Promise<void> {
  if (state.rowImports.some((r) => r.id === id)) return;
  await dispatchProduct(ctx, [
    productActions.startRowImport({
      id,
      materialId: file.source.materialId,
      sheet: file.source.sheet,
      documentType: file.documentType,
      rows: file.documents.length,
      at: new Date().toISOString(),
    }),
  ]);
}

async function finishImport(
  ctx: ImportRowsContext,
  id: string,
  imported: number,
  failure: string | null,
): Promise<void> {
  await dispatchProduct(ctx, [
    productActions.finishRowImport({
      id,
      imported,
      status: failure ? "FAILED" : "DONE",
      ...(failure ? { failure } : {}),
      at: new Date().toISOString(),
    }),
  ]);
}

/** Copy the file's missing rows into the live product. */
export async function runImport(
  ctx: ImportRowsContext,
  file: string,
): Promise<ImportRunResult> {
  const product = await getProductDoc(ctx);
  if (!product || !product.state.liveUrl) {
    throw new ImportRowsError(
      "no-drive",
      "Your product is not live yet.",
    );
  }
  const names = materialNames(product.state);
  const found = (await liveProjects(ctx))
    .flatMap((project) => importFiles(project, names))
    .find((f) => f.file === file);
  if (!found) {
    throw new ImportRowsError("unknown-file", `Unknown import file "${file}".`);
  }
  const { client, driveId } = await driveFor(ctx);
  const progress = readProgress(ctx.workdir, file, importId(file));
  await startImport(ctx, product.state, found.value, progress.id);

  const imported = new Set(progress.imported);
  const actionsOf = (
    doc: ImportFile["documents"][number],
  ): SeedAction[] =>
    doc.actions.map((a) => ({
      type: a.type,
      input: a.input as Record<string, unknown>,
      scope: "global",
    }));

  for (const [index, doc] of found.value.documents.entries()) {
    if (imported.has(index)) continue;
    try {
      const docId = await client.createDocument(driveId, {
        documentType: found.value.documentType,
        name: doc.name,
      });
      await client.applyActions(docId, actionsOf(doc));
      imported.add(index);
      progress.imported = [...imported].sort((a, b) => a - b);
      writeProgress(ctx.workdir, file, progress);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await finishImport(ctx, progress.id, imported.size, reason);
      return { imported: imported.size, failed: 1 };
    }
  }
  await finishImport(ctx, progress.id, imported.size, null);
  return { imported: imported.size, failed: 0 };
}


