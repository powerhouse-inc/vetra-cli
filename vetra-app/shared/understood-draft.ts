/**
 * The "What I understood" draft: a small, editable picture of what a fast
 * model pass understood from the customer's material (diagram, sheet, text).
 *
 * Pure TypeScript, no React/DOM/browser imports: it is used by the Studio
 * editor (browser) and by vetra-cli's understand pass (Node) through the
 * `vetra-app/shared/understood-draft` package export. Keep it a single file
 * with no relative runtime imports (it is transpiled file-by-file at build).
 */

export type Language = "en" | "de";

export type DraftFieldType =
  | "text"
  | "number"
  | "date"
  | "yes-no"
  | "choice"
  | "person"
  | "photo"
  | "place";

export const DRAFT_FIELD_TYPES: readonly DraftFieldType[] = [
  "text",
  "number",
  "date",
  "yes-no",
  "choice",
  "person",
  "photo",
  "place",
];

export type DraftFieldSource = {
  materialId: string;
  sheet: string | null;
  column: string | null;
};
export type DraftField = {
  id: string;
  name: string;
  type: DraftFieldType;
  options: string[];
  source: DraftFieldSource | null;
  /** Further sources of the same field after a merge (additive, optional). */
  alsoFrom?: DraftFieldSource[];
};
export type DraftThing = { id: string; name: string; fields: DraftField[] };
export type DraftRole = { id: string; name: string };
export type DraftStep = {
  id: string;
  name: string;
  roleId: string | null;
  thingId: string | null;
};
export type DraftLink = { from: string; to: string; label: string };
export type DraftMaterialKind = "PICTURE" | "PDF" | "SHEET" | "TEXT";
export type DraftMaterial = {
  id: string;
  name: string;
  kind: DraftMaterialKind;
};

export type UnderstoodDraft = {
  version: 1;
  language: "de" | "en";
  summary: string;
  things: DraftThing[];
  roles: DraftRole[];
  steps: DraftStep[];
  links: DraftLink[];
  questions: string[];
  materials: DraftMaterial[];
};

/** Upper bounds applied by `parseDraft` (the understand-pass limits). */
export const DRAFT_LIMITS = {
  things: 8,
  fieldsPerThing: 15,
  options: 12,
  roles: 8,
  steps: 12,
  links: 20,
  questions: 3,
  materials: 20,
  text: 200,
  summary: 600,
} as const;

// ---------------------------------------------------------------- names

/**
 * Fold a name for comparison: lower case, German umlauts and ß folded
 * (ä→a, ö→o, ü→u, ß→ss), non-alphanumerics dropped, then one plural ending
 * (-en, -e, -s) stripped from words longer than 4 letters. So "Mangel"
 * and "Mängel" and "Prüfung"/"Prüfungen" compare equal.
 */
export function normalizeName(name: string): string {
  const folded = name
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  if (!folded) return name.trim().toLowerCase();
  return folded
    .split(" ")
    .map((w) => (w.length > 4 ? w.replace(/(en|e|s)$/, "") : w))
    .join(" ");
}

// ---------------------------------------------------------------- parse

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function idOf(v: unknown, ids: () => string): string {
  return typeof v === "string" && v.trim() ? v.trim() : ids();
}
function nullableId(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1], raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c.trim());
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function parseField(v: unknown, ids: () => string): DraftField | null {
  if (!isRecord(v)) return null;
  const name = str(v.name, DRAFT_LIMITS.text);
  if (!name) return null;
  const type = DRAFT_FIELD_TYPES.find((t) => t === v.type) ?? "text";
  const s = isRecord(v.source) ? v.source : null;
  const materialId = s ? nullableId(s.materialId) : null;
  return {
    id: idOf(v.id, ids),
    name,
    type,
    options: arr(v.options)
      .map((o) => str(o, DRAFT_LIMITS.text))
      .filter(Boolean)
      .slice(0, DRAFT_LIMITS.options),
    source:
      s && materialId
        ? {
            materialId,
            sheet: nullableId(s.sheet),
            column: nullableId(s.column),
          }
        : null,
  };
}

/** Lenient parse of a model reply into a draft; null when it has no things. */
export function parseDraft(
  raw: string,
  ids: () => string,
  { requireThings = true }: { requireThings?: boolean } = {},
): UnderstoodDraft | null {
  const json = extractJson(raw);
  if (!isRecord(json)) return null;
  const things: DraftThing[] = [];
  for (const t of arr(json.things)) {
    if (!isRecord(t)) continue;
    const name = str(t.name, DRAFT_LIMITS.text);
    if (!name) continue;
    const fields: DraftField[] = [];
    for (const f of arr(t.fields)) {
      const field = parseField(f, ids);
      if (field) fields.push(field);
    }
    things.push({
      id: idOf(t.id, ids),
      name,
      fields: fields.slice(0, DRAFT_LIMITS.fieldsPerThing),
    });
  }
  const roles: DraftRole[] = [];
  for (const r of arr(json.roles)) {
    const name = isRecord(r) ? str(r.name, DRAFT_LIMITS.text) : "";
    if (name && isRecord(r)) roles.push({ id: idOf(r.id, ids), name });
  }
  const steps: DraftStep[] = [];
  for (const s of arr(json.steps)) {
    const name = isRecord(s) ? str(s.name, DRAFT_LIMITS.text) : "";
    if (name && isRecord(s))
      steps.push({
        id: idOf(s.id, ids),
        name,
        roleId: nullableId(s.roleId),
        thingId: nullableId(s.thingId),
      });
  }
  const links: DraftLink[] = [];
  for (const l of arr(json.links)) {
    if (!isRecord(l)) continue;
    const from = nullableId(l.from);
    const to = nullableId(l.to);
    if (from && to)
      links.push({ from, to, label: str(l.label, DRAFT_LIMITS.text) });
  }
  const materials: DraftMaterial[] = [];
  for (const m of arr(json.materials)) {
    if (!isRecord(m)) continue;
    const kind = (["PICTURE", "PDF", "SHEET", "TEXT"] as const).find(
      (k) => k === m.kind,
    );
    const id = nullableId(m.id);
    if (kind && id)
      materials.push({ id, name: str(m.name, DRAFT_LIMITS.text), kind });
  }
  const summary = str(json.summary, DRAFT_LIMITS.summary);
  // A diagram can carry roles and steps without things; every other
  // caller keeps the strict "a draft has things" rule.
  if (
    things.length === 0 &&
    (requireThings || (roles.length === 0 && steps.length === 0 && !summary))
  ) {
    return null;
  }
  const keptThings = things.slice(0, DRAFT_LIMITS.things);
  const keptRoles = roles.slice(0, DRAFT_LIMITS.roles);
  const thingIds = new Set(keptThings.map((t) => t.id));
  const roleIds = new Set(keptRoles.map((r) => r.id));
  return {
    version: 1,
    language: json.language === "de" ? "de" : "en",
    summary,
    things: keptThings,
    roles: keptRoles,
    steps: steps.slice(0, DRAFT_LIMITS.steps).map((s) => ({
      ...s,
      roleId: s.roleId && roleIds.has(s.roleId) ? s.roleId : null,
      thingId: s.thingId && thingIds.has(s.thingId) ? s.thingId : null,
    })),
    links: links
      .filter((l) => thingIds.has(l.from) && thingIds.has(l.to))
      .slice(0, DRAFT_LIMITS.links),
    questions: arr(json.questions)
      .map((q) => str(q, DRAFT_LIMITS.text))
      .filter(Boolean)
      .slice(0, DRAFT_LIMITS.questions),
    materials: materials.slice(0, DRAFT_LIMITS.materials),
  };
}

// ---------------------------------------------------------------- merge

function sameSource(a: DraftFieldSource, b: DraftFieldSource): boolean {
  return (
    a.materialId === b.materialId &&
    a.sheet === b.sheet &&
    a.column === b.column
  );
}

/** All sources of a field, primary first. */
export function fieldSources(f: DraftField): DraftFieldSource[] {
  return [...(f.source ? [f.source] : []), ...(f.alsoFrom ?? [])];
}

/** Merge `other` into `keep`: first type wins, options unioned, sources kept. */
function mergeField(keep: DraftField, other: DraftField): DraftField {
  const options = [...keep.options];
  for (const o of other.options) if (!options.includes(o)) options.push(o);
  const sources = fieldSources(keep);
  for (const s of fieldSources(other))
    if (!sources.some((x) => sameSource(x, s))) sources.push(s);
  const [source = null, ...rest] = sources;
  const merged: DraftField = { ...keep, options, source };
  if (rest.length > 0) merged.alsoFrom = rest;
  return merged;
}

/**
 * Merge several drafts (one per material) into one. Things with the same
 * normalised name merge (fields by normalised name, first type wins); roles
 * merge by name; steps are concatenated without duplicates; links are
 * re-pointed to the merged ids. A merged field keeps every distinct source
 * (the first in `source`, the rest in `alsoFrom`).
 */
export function mergeDrafts(drafts: UnderstoodDraft[]): UnderstoodDraft {
  const out: UnderstoodDraft = {
    version: 1,
    language: drafts[0]?.language ?? "en",
    summary: "",
    things: [],
    roles: [],
    steps: [],
    links: [],
    questions: [],
    materials: [],
  };
  const summaries: string[] = [];
  for (const d of drafts) {
    const thingMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    if (d.summary && !summaries.includes(d.summary)) summaries.push(d.summary);
    for (const t of d.things) {
      const key = normalizeName(t.name);
      const existing = out.things.find((x) => normalizeName(x.name) === key);
      if (!existing) {
        out.things.push({ ...t, fields: t.fields.map((f) => ({ ...f })) });
        thingMap.set(t.id, t.id);
        continue;
      }
      thingMap.set(t.id, existing.id);
      for (const f of t.fields) {
        const fk = normalizeName(f.name);
        const ef = existing.fields.find((x) => normalizeName(x.name) === fk);
        if (!ef) existing.fields.push({ ...f });
        else existing.fields[existing.fields.indexOf(ef)] = mergeField(ef, f);
      }
    }
    for (const r of d.roles) {
      const key = normalizeName(r.name);
      const existing = out.roles.find((x) => normalizeName(x.name) === key);
      if (existing) roleMap.set(r.id, existing.id);
      else {
        out.roles.push({ ...r });
        roleMap.set(r.id, r.id);
      }
    }
    for (const s of d.steps) {
      const step: DraftStep = {
        ...s,
        roleId: s.roleId ? (roleMap.get(s.roleId) ?? null) : null,
        thingId: s.thingId ? (thingMap.get(s.thingId) ?? null) : null,
      };
      const dup = out.steps.some(
        (x) =>
          normalizeName(x.name) === normalizeName(step.name) &&
          x.roleId === step.roleId &&
          x.thingId === step.thingId,
      );
      if (!dup) out.steps.push(step);
    }
    for (const l of d.links) {
      const from = thingMap.get(l.from);
      const to = thingMap.get(l.to);
      if (!from || !to) continue;
      if (
        !out.links.some(
          (x) => x.from === from && x.to === to && x.label === l.label,
        )
      )
        out.links.push({ from, to, label: l.label });
    }
    for (const q of d.questions)
      if (!out.questions.includes(q)) out.questions.push(q);
    for (const m of d.materials)
      if (!out.materials.some((x) => x.id === m.id))
        out.materials.push({ ...m });
  }
  out.summary = summaries.join(" ");
  return out;
}

// ---------------------------------------------------------------- edits

type D = UnderstoodDraft;

function mapThing(d: D, thingId: string, fn: (t: DraftThing) => DraftThing): D {
  return { ...d, things: d.things.map((t) => (t.id === thingId ? fn(t) : t)) };
}
function mapField(
  d: D,
  thingId: string,
  fieldId: string,
  fn: (f: DraftField) => DraftField,
): D {
  return mapThing(d, thingId, (t) => ({
    ...t,
    fields: t.fields.map((f) => (f.id === fieldId ? fn(f) : f)),
  }));
}

export const renameThing = (d: D, thingId: string, name: string): D =>
  mapThing(d, thingId, (t) => ({ ...t, name }));

export const addThing = (d: D, id: string, name: string): D => ({
  ...d,
  things: [...d.things, { id, name, fields: [] }],
});

export const removeThing = (d: D, thingId: string): D => ({
  ...d,
  things: d.things.filter((t) => t.id !== thingId),
  links: d.links.filter((l) => l.from !== thingId && l.to !== thingId),
  steps: d.steps.map((s) =>
    s.thingId === thingId ? { ...s, thingId: null } : s,
  ),
});

/** Fold `otherId` into `keepId`: fields merged, links and steps re-pointed. */
export function mergeThings(d: D, keepId: string, otherId: string): D {
  const keep = d.things.find((t) => t.id === keepId);
  const other = d.things.find((t) => t.id === otherId);
  if (!keep || !other || keepId === otherId) return d;
  const fields = keep.fields.map((f) => ({ ...f }));
  for (const f of other.fields) {
    const key = normalizeName(f.name);
    const i = fields.findIndex((x) => normalizeName(x.name) === key);
    if (i < 0) fields.push({ ...f });
    else fields[i] = mergeField(fields[i], f);
  }
  const links: DraftLink[] = [];
  for (const l of d.links) {
    const from = l.from === otherId ? keepId : l.from;
    const to = l.to === otherId ? keepId : l.to;
    if (from === to) continue;
    if (
      !links.some((x) => x.from === from && x.to === to && x.label === l.label)
    )
      links.push({ from, to, label: l.label });
  }
  return {
    ...d,
    things: d.things
      .filter((t) => t.id !== otherId)
      .map((t) => (t.id === keepId ? { ...t, fields } : t)),
    links,
    steps: d.steps.map((s) =>
      s.thingId === otherId ? { ...s, thingId: keepId } : s,
    ),
  };
}

/** Move the chosen fields of a thing onto a new thing right after it. */
export function splitThing(
  d: D,
  thingId: string,
  fieldIds: string[],
  newId: string,
  newName: string,
): D {
  const src = d.things.find((t) => t.id === thingId);
  if (!src) return d;
  const moved = src.fields.filter((f) => fieldIds.includes(f.id));
  const rest = src.fields.filter((f) => !fieldIds.includes(f.id));
  const things: DraftThing[] = [];
  for (const t of d.things) {
    if (t.id === thingId) {
      things.push({ ...t, fields: rest });
      things.push({ id: newId, name: newName, fields: moved });
    } else things.push(t);
  }
  return { ...d, things };
}

export const renameField = (
  d: D,
  thingId: string,
  fieldId: string,
  name: string,
): D => mapField(d, thingId, fieldId, (f) => ({ ...f, name }));

export const addField = (d: D, thingId: string, field: DraftField): D =>
  mapThing(d, thingId, (t) => ({ ...t, fields: [...t.fields, field] }));

export const removeField = (d: D, thingId: string, fieldId: string): D =>
  mapThing(d, thingId, (t) => ({
    ...t,
    fields: t.fields.filter((f) => f.id !== fieldId),
  }));

export const setFieldType = (
  d: D,
  thingId: string,
  fieldId: string,
  type: DraftFieldType,
): D => mapField(d, thingId, fieldId, (f) => ({ ...f, type }));

export const renameRole = (d: D, roleId: string, name: string): D => ({
  ...d,
  roles: d.roles.map((r) => (r.id === roleId ? { ...r, name } : r)),
});
export const addRole = (d: D, id: string, name: string): D => ({
  ...d,
  roles: [...d.roles, { id, name }],
});
export const removeRole = (d: D, roleId: string): D => ({
  ...d,
  roles: d.roles.filter((r) => r.id !== roleId),
  steps: d.steps.map((s) => (s.roleId === roleId ? { ...s, roleId: null } : s)),
});

export const renameStep = (d: D, stepId: string, name: string): D => ({
  ...d,
  steps: d.steps.map((s) => (s.id === stepId ? { ...s, name } : s)),
});
export const addStep = (d: D, step: DraftStep): D => ({
  ...d,
  steps: [...d.steps, step],
});
export const removeStep = (d: D, stepId: string): D => ({
  ...d,
  steps: d.steps.filter((s) => s.id !== stepId),
});
export function moveStep(d: D, stepId: string, toIndex: number): D {
  const from = d.steps.findIndex((s) => s.id === stepId);
  if (from < 0) return d;
  const steps = [...d.steps];
  const [step] = steps.splice(from, 1);
  steps.splice(Math.max(0, Math.min(toIndex, steps.length)), 0, step);
  return { ...d, steps };
}
export const setStepRole = (
  d: D,
  stepId: string,
  roleId: string | null,
): D => ({
  ...d,
  steps: d.steps.map((s) => (s.id === stepId ? { ...s, roleId } : s)),
});

// ---------------------------------------------------------------- brief

/**
 * The text block the build receives. English labels always (agent-facing);
 * names stay as the customer wrote them. `lang` is accepted for symmetry with
 * the other brief builders and currently does not change the labels.
 */
export function draftToBrief(d: UnderstoodDraft, _lang: Language): string {
  const thingName = (id: string | null) =>
    d.things.find((t) => t.id === id)?.name ?? null;
  const roleName = (id: string | null) =>
    d.roles.find((r) => r.id === id)?.name ?? null;
  const lines: string[] = ["[What we understood — confirmed by the customer]"];
  if (d.summary) lines.push(d.summary);
  lines.push("", "Things to keep track of:");
  for (const t of d.things) {
    if (t.fields.length === 0) lines.push(`- ${t.name}`);
    for (const f of t.fields) {
      const opts =
        f.type === "choice" && f.options.length
          ? `: ${f.options.join("|")}`
          : "";
      const srcs = fieldSources(f).map(
        (s) =>
          [s.sheet, s.column].filter((x) => x !== null).join(" › ") ||
          (d.materials.find((m) => m.id === s.materialId)?.name ??
            s.materialId),
      );
      lines.push(
        `- ${t.name}: ${f.name} (${f.type}${opts})${srcs.length ? ` [from ${srcs.join("; ")}]` : ""}`,
      );
    }
  }
  if (d.roles.length)
    lines.push("", `Who: ${d.roles.map((r) => r.name).join(", ")}`);
  if (d.steps.length) {
    lines.push("", "Steps:");
    d.steps.forEach((s, i) => {
      const extra = [roleName(s.roleId), thingName(s.thingId)].filter(Boolean);
      lines.push(
        `${i + 1}. ${s.name}${extra.length ? ` (${extra.join(", ")})` : ""}`,
      );
    });
  }
  const links = d.links.filter((l) => thingName(l.from) && thingName(l.to));
  if (links.length) {
    lines.push("", "Links:");
    for (const l of links)
      lines.push(
        `${thingName(l.from)} → ${thingName(l.to)}${l.label ? ` (${l.label})` : ""}`,
      );
  }
  if (d.questions.length)
    lines.push("", `Open questions: ${d.questions.join(" ")}`);
  return lines.join("\n");
}
