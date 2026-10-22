/**
 * "What I understood": one fast model call per input (each piece of material,
 * plus the typed description when there is one), in parallel; the replies
 * are parsed into drafts and merged into one.
 */
import { randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { APICallError, generateText, RetryError, type ModelMessage, type UserContent } from "ai";
import {
  DRAFT_LIMITS,
  mergeDrafts,
  parseDraft,
  type DraftFieldSource,
  type UnderstoodDraft,
} from "vetra-app/shared/understood-draft";
import { callCostUsd, createModel, type LlmSettings } from "../agents/llm.js";
import type { MaterialInfo } from "./material.js";
import {
  materialHeading,
  sheetAsText,
  understandSystemPrompt,
  type Language,
} from "./understand-prompt.js";

export type { Language } from "./understand-prompt.js";

export const UNDERSTAND_MAX_INPUTS = 6;
/** The cap covers reasoning tokens too: a reasoning model that spends the
 * whole budget thinking returns empty `content` (or a cut-off JSON), which was
 * the P5 "pruefcheckliste.xlsx konnte ich nicht lesen" failure at 4096. */
export const UNDERSTAND_MAX_OUTPUT_TOKENS = 8192;
/** A retry gets more room than the attempt that was cut off — repeating the
 * same cap only repeats the truncation. */
export const UNDERSTAND_RETRY_MAX_OUTPUT_TOKENS = 16_384;
export const UNDERSTAND_TIMEOUT_MS = 75_000;
/** A reply that isn't a draft (or a transient provider error) gets one more call. */
export const UNDERSTAND_ATTEMPTS = 2;
/** Characters of a text material sent to the model. */
export const TEXT_MATERIAL_MAX_CHARS = 20_000;

export type UnderstandNote = { materialId: string | null; text: string };

export type UnderstandResult = {
  draft: UnderstoodDraft;
  notes: UnderstandNote[];
  costUsd: number;
  ms: number;
};

/** One model call, as the understand pass makes it. */
export type UnderstandRequest = {
  system: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  abortSignal: AbortSignal;
};

export type UnderstandDeps = {
  /** `finishReason` is the provider's ("length" when the output cap cut the
   * reply off, reasoning tokens included), used to name the retry's failure. */
  generate: (
    req: UnderstandRequest,
  ) => Promise<{ text: string; finishReason?: string; providerMetadata?: unknown }>;
  /** Id source for draft items the model left without one. */
  ids?: () => string;
};

/** The provider refused because the Studio's budget is used up. */
export class UnderstandBudgetError extends Error {
  constructor() {
    super("budget");
    this.name = "UnderstandBudgetError";
  }
}

/** Every input failed: there is nothing to show. */
export class UnderstandUnreadableError extends Error {
  constructor(readonly notes: UnderstandNote[]) {
    super("unreadable");
    this.name = "UnderstandUnreadableError";
  }
}

/** The real model call: the Studio's understand model behind the per-Studio routing. */
export function createUnderstandDeps(settings: LlmSettings): UnderstandDeps {
  // No model-level cap: each attempt passes its own maxOutputTokens, and a
  // retry must be able to ask for more than the attempt that was cut off.
  const model = createModel(settings, { modelId: settings.understandModel });
  return {
    generate: (req) =>
      generateText({
        model,
        system: req.system,
        messages: req.messages,
        maxOutputTokens: req.maxOutputTokens,
        abortSignal: req.abortSignal,
        maxRetries: 1,
      }),
  };
}

/** The note for an input that could not be read. */
export function unreadableNote(name: string, language: Language): string {
  if (language === "de") {
    return `${name} konnte ich nicht lesen. Beschreib es stattdessen in einem Satz.`;
  }
  return `Couldn't read ${name}. Describe it in a sentence instead.`;
}

/** The typed description's name in a note (German: it starts the sentence). */
const TEXT_INPUT_NAME: Record<Language, string> = { de: "Deinen Text", en: "your text" };

/** True for a provider refusal that means the budget (or key limit) is used up. */
export function isBudgetError(err: unknown): boolean {
  const e = RetryError.isInstance(err) ? err.lastError : err;
  if (!APICallError.isInstance(e)) return false;
  if (e.statusCode === 402) return true;
  return e.statusCode === 403 && /limit|credit|budget/i.test(e.message);
}

async function head(path: string, n = 32): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** The media type of a picture or PDF, from its first bytes. */
export function mediaTypeOf(h: Buffer): string {
  if (h.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (h[0] === 0x89 && h.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (h[0] === 0xff && h[1] === 0xd8) return "image/jpeg";
  if (h.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (h.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (h.subarray(4, 8).toString("latin1") === "ftyp") {
    return h.subarray(8, 12).toString("latin1") === "avif" ? "image/avif" : "image/heic";
  }
  return "application/octet-stream";
}

type Input = { material: MaterialInfo | null; name: string; content: () => Promise<UserContent> };

function inputsOf(materials: MaterialInfo[], text: string, language: Language): Input[] {
  const inputs: Input[] = materials.map((m) => ({
    material: m,
    name: m.name,
    content: async (): Promise<UserContent> => {
      const heading = { type: "text" as const, text: materialHeading(m) };
      if (m.kind === "PICTURE" || m.kind === "PDF") {
        const data = await readFile(m.path);
        return [heading, { type: "file", data, mediaType: mediaTypeOf(await head(m.path)) }];
      }
      if (m.kind === "SHEET") {
        const tables = (m.sheets ?? []).map(sheetAsText).join("\n\n");
        return [heading, { type: "text", text: tables || "(empty sheet)" }];
      }
      const body = (await readFile(m.path, "utf8")).slice(0, TEXT_MATERIAL_MAX_CHARS);
      return [heading, { type: "text", text: body }];
    },
  }));
  if (text.trim()) {
    inputs.push({
      material: null,
      name: TEXT_INPUT_NAME[language],
      content: async () => [{ type: "text", text: `Their own description:\n${text.trim()}` }],
    });
  }
  return inputs;
}

/** Reject when the signal fires, even if the call does not honour it. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Pin field sources to the input they came from: the material is the one
 * read (whatever id the model wrote), and a sheet/column the material does
 * not have is dropped. The typed description has no source.
 */
function pinSources(draft: UnderstoodDraft, material: MaterialInfo | null): UnderstoodDraft {
  const fix = (s: DraftFieldSource | null): DraftFieldSource | null => {
    if (!s || !material) return null;
    if (material.kind !== "SHEET") return { materialId: material.id, sheet: null, column: null };
    const table = material.sheets?.find((t) => t.sheet === s.sheet) ?? (material.sheets?.length === 1 ? material.sheets[0] : undefined);
    const column = table && s.column && table.header.includes(s.column) ? s.column : null;
    return { materialId: material.id, sheet: table?.sheet ?? null, column };
  };
  return {
    ...draft,
    things: draft.things.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f, source: fix(f.source) })) })),
  };
}

/** Prefix every id of one input's draft so ids of different inputs never clash. */
function namespaceIds(d: UnderstoodDraft, prefix: string): UnderstoodDraft {
  const p = (id: string) => `${prefix}${id}`;
  const pn = (id: string | null) => (id === null ? null : p(id));
  return {
    ...d,
    things: d.things.map((t) => ({ ...t, id: p(t.id), fields: t.fields.map((f) => ({ ...f, id: p(f.id) })) })),
    roles: d.roles.map((r) => ({ ...r, id: p(r.id) })),
    steps: d.steps.map((s) => ({ ...s, id: p(s.id), roleId: pn(s.roleId), thingId: pn(s.thingId) })),
    links: d.links.map((l) => ({ ...l, from: p(l.from), to: p(l.to) })),
  };
}

/** Apply the draft limits to a merged draft (merging can exceed them). */
export function clampDraft(d: UnderstoodDraft): UnderstoodDraft {
  const things = d.things
    .slice(0, DRAFT_LIMITS.things)
    .map((t) => ({ ...t, fields: t.fields.slice(0, DRAFT_LIMITS.fieldsPerThing) }));
  const roles = d.roles.slice(0, DRAFT_LIMITS.roles);
  const thingIds = new Set(things.map((t) => t.id));
  const roleIds = new Set(roles.map((r) => r.id));
  return {
    ...d,
    summary: d.summary.slice(0, DRAFT_LIMITS.summary),
    things,
    roles,
    steps: d.steps.slice(0, DRAFT_LIMITS.steps).map((s) => ({
      ...s,
      roleId: s.roleId && roleIds.has(s.roleId) ? s.roleId : null,
      thingId: s.thingId && thingIds.has(s.thingId) ? s.thingId : null,
    })),
    links: d.links.filter((l) => thingIds.has(l.from) && thingIds.has(l.to)).slice(0, DRAFT_LIMITS.links),
    questions: d.questions.slice(0, DRAFT_LIMITS.questions),
    materials: d.materials.slice(0, DRAFT_LIMITS.materials),
  };
}

export async function understand(
  deps: UnderstandDeps,
  input: { materials: MaterialInfo[]; text: string; language: Language },
): Promise<UnderstandResult> {
  const started = performance.now();
  const { language } = input;
  const inputs = inputsOf(input.materials, input.text, language);
  if (inputs.length > UNDERSTAND_MAX_INPUTS) {
    throw new RangeError(`at most ${UNDERSTAND_MAX_INPUTS} inputs`);
  }
  const ids = deps.ids ?? randomUUID;
  const system = understandSystemPrompt(language);

  const outcomes = await Promise.allSettled(
    inputs.map(async (inp, i) => {
      let cost = 0;
      let last: unknown;
      for (let attempt = 1; attempt <= UNDERSTAND_ATTEMPTS; attempt++) {
        const abortSignal = AbortSignal.timeout(UNDERSTAND_TIMEOUT_MS);
        try {
          // Re-read the material: a retry must resend the input, not just the
          // same request, and it gets more output room than the attempt that
          // was cut off.
          const content = await inp.content();
          const result = await raceAbort(
            deps.generate({
              system,
              messages: [{ role: "user", content }],
              maxOutputTokens:
                attempt === 1
                  ? UNDERSTAND_MAX_OUTPUT_TOKENS
                  : UNDERSTAND_RETRY_MAX_OUTPUT_TOKENS,
              abortSignal,
            }),
            abortSignal,
          );
          cost += callCostUsd(result) ?? 0;
          // A diagram may yield roles/steps but no things; that is still a read.
          const draft = parseDraft(result.text, ids, { requireThings: false });
          if (draft) {
            return {
              draft: namespaceIds(pinSources(draft, inp.material), `i${i}-`),
              cost,
            };
          }
          last = new Error(
            result.finishReason === "length"
              ? "reply cut off at the output cap"
              : "unparseable reply",
          );
        } catch (err) {
          if (isBudgetError(err) || abortSignal.aborted) throw err;
          last = err;
        }
      }
      throw last;
    }),
  );

  if (outcomes.some((o) => o.status === "rejected" && isBudgetError(o.reason))) {
    throw new UnderstandBudgetError();
  }

  const drafts: UnderstoodDraft[] = [];
  const notes: UnderstandNote[] = [];
  let costUsd = 0;
  outcomes.forEach((o, i) => {
    if (o.status === "fulfilled") costUsd += o.value.cost;
    if (o.status === "fulfilled" && o.value.draft) drafts.push(o.value.draft);
    else notes.push({ materialId: inputs[i].material?.id ?? null, text: unreadableNote(inputs[i].name, language) });
  });
  if (drafts.length === 0) throw new UnderstandUnreadableError(notes);

  const merged = clampDraft(mergeDrafts(drafts));
  return {
    draft: {
      ...merged,
      language,
      materials: input.materials.map(({ id, name, kind }) => ({ id, name, kind })),
    },
    notes,
    costUsd,
    ms: Math.round(performance.now() - started),
  };
}
