/**
 * `product-progress` — the agent's one way to move the Studio's step strip.
 *
 * Each call is one operation on the active change of the product document.
 * Gates live in the reducer: a refused `done` comes back as the reducer's
 * message so the agent sees why (e.g. the checks have not passed yet).
 */
import { randomUUID } from "node:crypto";
import type { Action } from "document-model";
import { z } from "zod";
import { StudioProductV1 } from "vetra-app/document-models";
import type { placeholderName as PlaceholderName } from "vetra-app/document-models/studio-product";
import { defineCommand } from "../../framework.js";
import { activePhases, claimedMissingTools, toolsGained } from "../../agents/phase-tools.js";
import { requestLiveTarget, type OrchestratorContext } from "../../launch/orchestrator.js";
import { findForbiddenWords } from "../../product/forbidden-words.js";
import {
  ProductRefusedError,
  activeChange,
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "../../product/product-doc.js";

/* The custom utils sit on the module's runtime `utils`; its declared type is
 * the generic DocumentModelUtils, so name the one used here. */
const placeholderName = (
  StudioProductV1.utils as unknown as { placeholderName: typeof PlaceholderName }
).placeholderName;

const stepKind = z.enum(["PLAN", "DATA", "EDITORS", "TESTS", "LIVE"]);

const inputSchema = z.object({
  action: z
    .enum(["plan", "start", "count", "done", "back", "milestone", "stuck", "suggest", "name", "title"])
    .describe(
      "plan: set the steps (`steps`). start: begin `step` (optional `label`). count: progress on `step` (`done` of `total`). done: finish `step` (refused until its checks pass). back: return to a finished `step` (`reason`). milestone: one finished thing in the customer's words (`text`). stuck: after 3 failed attempts at the same thing (`reason`, `tried`). name: name the product (`text`, before finishing PLAN). title: title this change (`text`, before finishing PLAN). suggest: ideas for next time (`items`).",
    ),
  step: stepKind.optional().describe("The step this action is about."),
  steps: z
    .array(z.object({ kind: stepKind, total: z.number().int().min(0).optional() }))
    .optional()
    .describe("For plan: the steps of this change, in order, with optional item totals."),
  label: z.string().optional().describe("For start: what is being worked on now."),
  done: z.number().int().min(0).optional().describe("For count: items finished."),
  total: z.number().int().min(0).optional().describe("For count: items in the step."),
  reason: z.string().optional().describe("For back and stuck: why."),
  tried: z.array(z.string()).optional().describe("For stuck: what was tried."),
  text: z.string().optional().describe("For milestone, name and title."),
  items: z.array(z.string()).optional().describe("For suggest: the suggestions."),
});

type Input = z.output<typeof inputSchema>;

const STEP_NAMES = { PLAN: "Plan", DATA: "Data", EDITORS: "Editors", TESTS: "Tests", LIVE: "Live" } as const;

function missing(field: string, action: string): string {
  return `\`${field}\` is required for ${action}.`;
}

/** One refusal naming every forbidden word across `texts`, or null. */
function rephrase(...texts: Array<string | undefined>): string | null {
  const words = [...new Set(texts.flatMap((text) => (text ? findForbiddenWords(text) : [])))];
  return words.length ? `Rephrase in the customer's words without: ${words.join(", ")}.` : null;
}

/** `stuck` reasons refused for naming a visible tool, per change (process lifetime). */
const refusedStuck = new Set<string>();

/** Actions that can change the step, so the reply names the tools it adds. */
const MOVES_STEP = new Set<Input["action"]>(["start", "done", "back"]);
const MAX_LISTED = 12;

function gainedLine(gained: string[]): string {
  if (gained.length === 0) return "";
  const shown = gained.slice(0, MAX_LISTED).join(", ");
  return ` Now available: ${shown}${gained.length > MAX_LISTED ? ", …" : ""}.`;
}

/** Validates the input and builds the actions, or returns why it is refused. */
function buildActions(
  input: Input,
  state: NonNullable<Awaited<ReturnType<typeof getProductDoc>>>["state"],
  change: { id: string; title?: string | null } | null,
): { actions: Action[]; ok: string } | { refused: string } {
  const changeId = change?.id ?? "";
  const at = new Date().toISOString();
  const { step } = input;
  switch (input.action) {
    case "plan": {
      if (!input.steps?.length) return { refused: missing("steps", "plan") };
      const steps = input.steps.map((s) => ({ kind: s.kind, total: s.total ?? null }));
      return {
        actions: [a.planSteps({ changeId, steps })],
        ok: `Planned ${steps.map((s) => STEP_NAMES[s.kind]).join(" → ")}.`,
      };
    }
    case "start": {
      if (!step) return { refused: missing("step", "start") };
      const bad = rephrase(input.label);
      if (bad) return { refused: bad };
      return {
        actions: [a.startStep({ changeId, kind: step, label: input.label ?? null, at })],
        ok: `${STEP_NAMES[step]} started.`,
      };
    }
    case "count":
      if (!step) return { refused: missing("step", "count") };
      if (input.done === undefined || input.total === undefined) {
        return { refused: "`done` and `total` are required for count." };
      }
      return {
        actions: [a.countStep({ changeId, kind: step, done: input.done, total: input.total })],
        ok: `${STEP_NAMES[step]}: ${input.done} of ${input.total}.`,
      };
    case "done":
      if (!step) return { refused: missing("step", "done") };
      if (step === "PLAN" && (!state.name || (state.idea && state.name === placeholderName(state.idea)))) {
        return { refused: "Choose the product name first (product-progress name)." };
      }
      if (step === "PLAN" && !change?.title) {
        return { refused: "Title this change first (product-progress title)." };
      }
      return {
        actions: [a.completeStep({ changeId, kind: step, at })],
        ok: `${STEP_NAMES[step]} done.`,
      };
    case "back": {
      if (!step) return { refused: missing("step", "back") };
      if (!input.reason) return { refused: missing("reason", "back") };
      const bad = rephrase(input.reason);
      if (bad) return { refused: bad };
      return {
        actions: [a.reopenStep({ changeId, kind: step, reason: input.reason, at })],
        ok: `Back to ${STEP_NAMES[step]}.`,
      };
    }
    case "milestone": {
      if (!input.text) return { refused: missing("text", "milestone") };
      const bad = rephrase(input.text);
      if (bad) return { refused: bad };
      return {
        actions: [a.addMilestone({ changeId, id: randomUUID(), text: input.text, at })],
        ok: "Milestone recorded.",
      };
    }
    case "stuck": {
      if (!input.reason) return { refused: missing("reason", "stuck") };
      const tried = input.tried ?? [];
      // Refused once per change and reason: a repeat goes through, so a
      // misread claim can never leave the agent without a way to ask for help.
      const key = `${changeId}\n${input.reason}`;
      const present = refusedStuck.has(key) ? [] : claimedMissingTools(input.reason, activePhases(state));
      if (present.length) {
        refusedStuck.add(key);
        return {
          refused: `${present.join(", ")} ${present.length > 1 ? "are" : "is"} available in this step — use ${present.length > 1 ? "them" : "it"}.`,
        };
      }
      const bad = rephrase(input.reason, ...tried);
      if (bad) return { refused: bad };
      return {
        actions: [a.markStuck({ changeId, reason: input.reason, tried, at })],
        ok: "Marked as stuck; the customer will be asked for help.",
      };
    }
    case "name": {
      if (!input.text) return { refused: missing("text", "name") };
      if (state.liveVersion !== null && state.liveVersion !== undefined) {
        return { refused: "The live address is fixed; the name can change in Settings." };
      }
      const bad = rephrase(input.text);
      if (bad) return { refused: bad };
      return { actions: [a.renameProduct({ name: input.text })], ok: `Product named "${input.text}".` };
    }
    case "title": {
      if (!input.text) return { refused: missing("text", "title") };
      const bad = rephrase(input.text);
      if (bad) return { refused: bad };
      return {
        actions: [a.setChangeTitle({ changeId, title: input.text })],
        ok: `Change titled "${input.text}".`,
      };
    }
    case "suggest":
      return { refused: "suggest is not available yet." };
  }
}

type ProgressContext = ProductContext & Partial<OrchestratorContext>;

type ProductState = NonNullable<Awaited<ReturnType<typeof getProductDoc>>>["state"];

/**
 * D8: once the plan is done, the App and its production environment are
 * requested in the background (`SET_LIVE_TARGET`), so the live app is up by
 * the time the tests pass. A failure is logged at error and tried again at
 * the next step change. Only in a Studio (an environment id is configured).
 */
function prepareLiveTarget(ctx: ProgressContext, state: ProductState): void {
  if (state.appId || !ctx.workdir || !ctx.config?.environmentId) return;
  const planDone = state.changes.some((c) => c.steps.some((s) => s.kind === "PLAN" && s.status === "DONE"));
  if (!planDone) return;
  void requestLiveTarget({ ...ctx, workdir: ctx.workdir, config: ctx.config });
}

/** Runs one progress action; returns the text the agent sees. */
export async function runProgress(ctx: ProgressContext, input: Input): Promise<string> {
  if (input.action === "suggest") return "suggest is not available yet.";
  const product = await getProductDoc(ctx);
  if (!product) return "There is no product in this Studio yet; nothing was recorded.";
  // `name` acts on the product; everything else on the active change.
  const change = activeChange(product.state);
  if (!change && input.action !== "name") {
    return "There is no active change; nothing was recorded.";
  }
  const built = buildActions(input, product.state, change);
  if ("refused" in built) return `Refused: ${built.refused}`;
  try {
    await dispatchProduct(ctx, built.actions);
  } catch (err) {
    if (err instanceof ProductRefusedError) return `Refused: ${err.message}`;
    throw err;
  }
  if (!MOVES_STEP.has(input.action)) return built.ok;
  const after = await getProductDoc(ctx);
  if (!after) return built.ok;
  prepareLiveTarget(ctx, after.state);
  return built.ok + gainedLine(toolsGained(activePhases(product.state), activePhases(after.state)));
}

export const productProgress = defineCommand({
  id: "product-progress",
  description:
    "Record build progress on the Studio's product: plan the steps, start/count/finish a step, go back, add a milestone in the customer's words, report being stuck, name the product, title the change. `done` is refused until the step's checks pass; the reply says why. `start`/`done`/`back` replies name the tools that just became available.",
  inputSchema,
  execute: async (input, ctx) => ({ text: await runProgress(ctx, input) }),
});
