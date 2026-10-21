/**
 * The prompt of the understand pass: one fast model call per piece of
 * material, answered with JSON in the `UnderstoodDraft` shape.
 */
import { DRAFT_FIELD_TYPES, DRAFT_LIMITS } from "vetra-app/shared/understood-draft";
import type { SheetTable } from "./sheets.js";

export type Language = "de" | "en";

/** Rows of a sheet shown to the model; the rest is only counted. */
export const SHEET_SAMPLE_ROWS = 20;

const LANGUAGE_NAME: Record<Language, string> = { de: "German", en: "English" };

/** The instruction that makes every name come back in the user's language. */
export function languageInstruction(language: Language): string {
  return `Write every name, the summary and the questions in ${LANGUAGE_NAME[language]}.`;
}

export function understandSystemPrompt(language: Language): string {
  return [
    "You read material a small team brought along (a photo of a form, a diagram, a sheet, a PDF or a description)",
    "and say which things their product should keep track of, with which fields, who does what, and in which steps.",
    "",
    "Reply with JSON only, no other text, in exactly this shape:",
    '{"summary": string, "things": [{"id": string, "name": string, "fields": [{"id": string, "name": string, "type": string, "options": [string], "source": {"materialId": string, "sheet": string | null, "column": string | null} | null}]}],',
    ' "roles": [{"id": string, "name": string}], "steps": [{"id": string, "name": string, "roleId": string | null, "thingId": string | null}],',
    ' "links": [{"from": thingId, "to": thingId, "label": string}], "questions": [string]}',
    "",
    "Rules:",
    `- ${languageInstruction(language)}`,
    `- Field types (only these): ${DRAFT_FIELD_TYPES.join(", ")}. "choice" lists its options; "yes-no" is a tick box; "person" is someone; "place" is a location.`,
    "- For a sheet: each column becomes a field with that column's name, and source {materialId, sheet, column} naming the sheet and the column exactly as given.",
    "- For a diagram: swimlanes or actors become roles; boxes and arrows become steps in order, each with its roleId.",
    `- At most ${DRAFT_LIMITS.things} things, ${DRAFT_LIMITS.fieldsPerThing} fields per thing, ${DRAFT_LIMITS.steps} steps, ${DRAFT_LIMITS.questions} open questions.`,
    "- Ask an open question only where the material leaves something important unclear.",
    "- Never invent more than the material shows. Leave lists empty rather than guess.",
  ].join("\n");
}

/** A sheet as plain text: header, the first rows, and how many rows there are. */
export function sheetAsText(table: SheetTable): string {
  const row = (cells: string[]) => cells.map((c) => c.replace(/[\t\n\r]+/g, " ")).join("\t");
  const lines = [
    `Sheet "${table.sheet}" (${table.rowCount} rows; first ${Math.min(SHEET_SAMPLE_ROWS, table.rows.length)} shown, tab-separated)`,
    `Columns: ${table.header.map((h, i) => `${h} (${table.types[i] ?? "text"})`).join(", ")}`,
    row(table.header),
    ...table.rows.slice(0, SHEET_SAMPLE_ROWS).map(row),
  ];
  return lines.join("\n");
}

/** The first line of a user message: which material this is. */
export function materialHeading(m: { id: string; name: string; kind: string }): string {
  return `Material id "${m.id}", file "${m.name}" (${m.kind.toLowerCase()}).`;
}
