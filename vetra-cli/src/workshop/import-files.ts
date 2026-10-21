/**
 * Row-import files (`import/<doc-type-slug>.json`): the agent writes one for
 * each thing that came from a sheet, with one document per sheet row, so the
 * customer's real rows can be brought in after the product is live (Task 1.8).
 *
 * Checked like the example documents in `seed/` (`validateSeeds`): known
 * document type, known operations, inputs that fit their schemas. The check
 * is a note at TESTS level, not a gate.
 */
import fs from "node:fs";
import path from "node:path";
import {
  inputProblem,
  isRecord,
  loadProjectModels,
  type ModelInfo,
} from "../launch/seed.js";

export const IMPORT_DIR = "import";
/** A sheet's real rows are imported in one go; more than this is a mistake. */
export const MAX_IMPORT_DOCUMENTS = 500;

export interface ImportSource {
  materialId: string;
  sheet: string;
}

export interface ImportMapping {
  column: string;
  field: string;
}

export interface ImportAction {
  type: string;
  input: unknown;
}

export interface ImportDocument {
  name: string;
  actions: ImportAction[];
}

export interface ImportFile {
  source: ImportSource;
  documentType: string;
  mapping: ImportMapping[];
  documents: ImportDocument[];
}

export type ImportFileRead =
  | { file: string; ok: true; value: ImportFile }
  | { file: string; ok: false; reason: string };

/** One line per file, as `reactor-project-check` reports it. */
export interface ImportCheck {
  file: string;
  ok: boolean;
  reason?: string;
}

const SHAPE =
  'expected { "source": { "materialId": string, "sheet": string }, "documentType": string, "mapping": [{ "column": string, "field": string }], "documents": [...] }';

/** The file's shape, before it is checked against the project's models. */
function readShape(
  json: unknown,
): { value: ImportFile } | { reason: string } {
  if (!isRecord(json)) return { reason: SHAPE };
  const source = json.source;
  if (
    !isRecord(source) ||
    typeof source.materialId !== "string" ||
    typeof source.sheet !== "string"
  ) {
    return {
      reason: 'source must be { "materialId": string, "sheet": string }',
    };
  }
  if (typeof json.documentType !== "string" || !json.documentType) {
    return { reason: "documentType must be a non-empty string" };
  }
  if (
    !Array.isArray(json.mapping) ||
    !json.mapping.every(
      (m) =>
        isRecord(m) &&
        typeof m.column === "string" &&
        typeof m.field === "string",
    )
  ) {
    return {
      reason: 'mapping must be [{ "column": string, "field": string }]',
    };
  }
  if (!Array.isArray(json.documents)) {
    return { reason: "documents must be an array" };
  }
  return {
    value: {
      source: { materialId: source.materialId, sheet: source.sheet },
      documentType: json.documentType,
      mapping: json.mapping.map((m) => {
        const row = m as Record<string, string>;
        return { column: row.column, field: row.field };
      }),
      documents: json.documents as ImportDocument[],
    },
  };
}

/** The first problem with a shape-checked file; null when it fits the models. */
function modelProblem(file: ImportFile, models: Map<string, ModelInfo>): string | null {
  const model = models.get(file.documentType);
  if (!model) {
    return `unknown document type "${file.documentType}" (this project defines: ${[...models.keys()].join(", ") || "none"})`;
  }
  if (file.documents.length > MAX_IMPORT_DOCUMENTS) {
    return `lists ${file.documents.length} documents; keep it to ${MAX_IMPORT_DOCUMENTS} or fewer`;
  }
  const documents: ImportDocument[] = [];
  for (const [i, raw] of file.documents.entries()) {
    if (
      !isRecord(raw) ||
      typeof raw.name !== "string" ||
      !Array.isArray(raw.actions)
    ) {
      return `document ${i + 1}: expected { "name": string, "actions": [...] }`;
    }
    const name = raw.name.trim();
    if (!name) return `document ${i + 1}: needs a name`;
    const actions: ImportAction[] = [];
    for (const [j, action] of raw.actions.entries()) {
      const at = `document ${i + 1} "${name}", action ${j + 1}`;
      if (!isRecord(action) || typeof action.type !== "string") {
        return `${at}: expected { "type": string, "input": {...} }`;
      }
      const op = model.operations.get(action.type);
      if (!op) {
        return `${at}: ${file.documentType} has no operation ${action.type}`;
      }
      const input = action.input ?? {};
      if (!isRecord(input)) {
        return `${at} ${action.type}: input must be an object`;
      }
      const problem = inputProblem(model, op, input);
      if (problem) return `${at} ${action.type}: ${problem}`;
      actions.push({ type: action.type, input });
    }
    documents.push({ name, actions });
  }
  // Normalised in place only after the whole file fits.
  file.documents = documents;
  return null;
}

/** Every import file in the project, sorted, with its first problem. */
export function readImports(
  projectPath: string,
  models: Map<string, ModelInfo> = loadProjectModels(projectPath),
): ImportFileRead[] {
  const dir = path.join(projectPath, IMPORT_DIR);
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const out: ImportFileRead[] = [];
  for (const name of files) {
    const file = `${IMPORT_DIR}/${name}`;
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    } catch (err) {
      out.push({
        file,
        ok: false,
        reason: `not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      });
      continue;
    }
    const shape = readShape(json);
    if ("reason" in shape) {
      out.push({ file, ok: false, reason: shape.reason });
      continue;
    }
    const problem = modelProblem(shape.value, models);
    if (problem) {
      out.push({ file, ok: false, reason: problem });
      continue;
    }
    out.push({ file, ok: true, value: shape.value });
  }
  return out;
}

/** What `reactor-project-check` reports for the project's import files. */
export function validateImports(projectPath: string): ImportCheck[] {
  return readImports(projectPath).map((read) =>
    read.ok
      ? { file: read.file, ok: true }
      : { file: read.file, ok: false, reason: read.reason },
  );
}
