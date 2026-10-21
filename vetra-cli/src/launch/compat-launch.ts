/**
 * The data-compatibility gate at launch (spec §6.5, designer's call D6).
 *
 * Before Version n goes live (n ≥ 2, something is live), every document model
 * in the working tree is compared with the same model in the live version
 * (its git tag). Additive changes launch normally: new optional fields, new
 * operations, new models. Anything else would break documents the product's
 * users already have, so the launch stops with a plain reason and the agent is
 * told to make the change additive. Nothing here ever touches a document.
 *
 * Ruling E9: GraphQL's `findBreakingChanges` on each model's state schema and
 * on each operation's input schema, plus a new (or newly) required field on an
 * existing state type, and removed/renamed operations and removed models.
 *
 * Step 1 (the 6.2.3 train): the reactor applies `UPGRADE_DOCUMENT` and the
 * codegen writes upgrade transitions, but nothing in the Studio's launch path
 * upgrades the documents in the product drive and the document-model editor's
 * versioning operations are not implemented — so the agent is told only the
 * additive path.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  BreakingChangeType,
  Kind,
  buildASTSchema,
  findBreakingChanges,
  isNonNullType,
  isObjectType,
  parse,
  visit,
  type BreakingChange,
  type DefinitionNode,
  type DocumentNode,
  GraphQLSchema,
} from "graphql";
import type { Action } from "document-model";
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { workspaceSafeDirectory } from "../helpers/workspace-git.js";
import type { ProductContext } from "../product/product-doc.js";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------------ */
/* Words                                                                     */
/* ------------------------------------------------------------------------ */

/** The start of the plain reason a blocked launch records with FAIL_LAUNCH. */
export const BREAKING_REASON_PREFIX = "this change would break data your users already have";
/**
 * The plain reason when the check couldn't run while live documents exist (or
 * the product drive couldn't be read): the launch fails closed; Try again
 * runs the check again.
 */
export const COMPAT_UNCHECKED_REASON = "we couldn't check that this change keeps your users' data safe";
/**
 * Id prefix of the agent messages the Studio writes into a conversation (not
 * the customer's words; the story hides them — vetra-app storyModel
 * `STUDIO_NOTE_ID_PREFIX`).
 */
export const STUDIO_NOTE_ID_PREFIX = "studio-note-";
/** What the agent is told when a launch is blocked. */
export const MAKE_ADDITIVE_MESSAGE =
  "Make this change additive: keep existing fields and operations, add new ones as optional.";
/** How many breaks the plain reason names before "and n more". */
export const REASON_MAX_ITEMS = 3;

/** `this change would break data your users already have: <what>.` */
export function breakingReason(breaking: Breaking[]): string {
  const whats = breaking.map((b) => b.what);
  const shown = whats.slice(0, REASON_MAX_ITEMS);
  const more = whats.length - shown.length;
  const what = more > 0 ? `${shown.join("; ")}; and ${more} more` : shown.join("; ");
  return `${BREAKING_REASON_PREFIX}: ${what}.`;
}

/** The message to the agent: the instruction, then every break by model. */
export function agentMessage(breaking: Breaking[]): string {
  return [
    MAKE_ADDITIVE_MESSAGE,
    "",
    "What would break for the live version's documents:",
    ...breaking.map((b) => `- ${b.model}: ${b.what}`),
  ].join("\n");
}

/* ------------------------------------------------------------------------ */
/* Comparing models                                                          */
/* ------------------------------------------------------------------------ */

export type ModelSpec = {
  documentType: string;
  stateSchema: string;
  operations: { name: string; inputSchema: string }[];
};

/**
 * `breaking`: what would break. `unreadable`: live descriptions that couldn't
 * be read, so nothing was compared for them (the gate treats that like a
 * check that couldn't run).
 */
export interface CompatResult {
  breaking: Breaking[];
  unreadable: string[];
}

export interface Breaking {
  model: string;
  what: string;
}

const BUILT_IN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/**
 * Build an SDL fragment on its own: every type it uses but does not define
 * (Powerhouse scalars like `OID`, or state enums an input refers to) is stubbed
 * as a scalar. An empty fragment is an empty schema; throws when it doesn't parse.
 */
function buildFragment(sdl: string): GraphQLSchema {
  if (!sdl.trim()) return new GraphQLSchema({});
  const doc = parse(sdl);
  const defined = new Set<string>();
  for (const def of doc.definitions) {
    if ("name" in def && def.name && def.kind !== Kind.DIRECTIVE_DEFINITION) defined.add(def.name.value);
  }
  const used = new Set<string>();
  visit(doc, {
    NamedType(node) {
      used.add(node.name.value);
    },
  });
  const stubs: DefinitionNode[] = [...used]
    .filter((name) => !defined.has(name) && !BUILT_IN_SCALARS.has(name))
    .map((name) => ({ kind: Kind.SCALAR_TYPE_DEFINITION, name: { kind: Kind.NAME, value: name } }));
  const full: DocumentNode = { ...doc, definitions: [...doc.definitions, ...stubs] };
  return buildASTSchema(full);
}

function quoted(text: string): string {
  return `"${text}"`;
}

/** The plain words for one of GraphQL's breaking changes. */
function describe(change: BreakingChange): string {
  const d = change.description.replace(/\.$/, "");
  switch (change.type) {
    case BreakingChangeType.FIELD_REMOVED: {
      const m = /^(\S+) was removed$/.exec(d);
      return m ? `field ${quoted(m[1])} was removed` : d;
    }
    case BreakingChangeType.TYPE_REMOVED: {
      const m = /^(\S+) was removed$/.exec(d);
      return m ? `${quoted(m[1])} was removed` : d;
    }
    case BreakingChangeType.FIELD_CHANGED_KIND: {
      const m = /^(\S+) changed type from (.+) to (.+)$/.exec(d);
      return m ? `field ${quoted(m[1])} changed type from ${m[2]} to ${m[3]}` : d;
    }
    case BreakingChangeType.VALUE_REMOVED_FROM_ENUM: {
      const m = /^(\S+) was removed from enum type (\S+)$/.exec(d);
      return m ? `${quoted(m[1])} was removed from ${quoted(m[2])}` : d;
    }
    case BreakingChangeType.REQUIRED_INPUT_FIELD_ADDED: {
      const m = /^A required field (\S+) on input type (\S+) was added$/.exec(d);
      return m ? `field ${quoted(`${m[2]}.${m[1]}`)} is new and required` : d;
    }
    default:
      return d;
  }
}

/**
 * New required fields on existing state types, and fields that became required:
 * documents written before have no value for them. (GraphQL calls both safe for
 * an API's readers; for stored data they are not.)
 */
function newlyRequired(live: GraphQLSchema, next: GraphQLSchema): string[] {
  const out: string[] = [];
  for (const [name, nextType] of Object.entries(next.getTypeMap())) {
    if (name.startsWith("__") || !isObjectType(nextType)) continue;
    const liveType = live.getType(name);
    if (!liveType || !isObjectType(liveType)) continue;
    const liveFields = liveType.getFields();
    for (const [fieldName, field] of Object.entries(nextType.getFields())) {
      if (!isNonNullType(field.type)) continue;
      const before = liveFields[fieldName];
      if (!before) out.push(`field ${quoted(`${name}.${fieldName}`)} is new and required`);
      else if (!isNonNullType(before.type)) out.push(`field ${quoted(`${name}.${fieldName}`)} is now required`);
    }
  }
  return out;
}

/**
 * What would break between two SDL fragments; null when the live one can't be
 * read (nothing compared; the caller reports it). A next fragment that doesn't
 * read is a break.
 */
function compareFragments(liveSdl: string, nextSdl: string, state: boolean): string[] | null {
  let live: GraphQLSchema;
  try {
    live = buildFragment(liveSdl);
  } catch {
    return null;
  }
  let next: GraphQLSchema;
  try {
    next = buildFragment(nextSdl);
  } catch {
    return ["its description can't be read"];
  }
  const out = findBreakingChanges(live, next).map(describe);
  if (state) out.push(...newlyRequired(live, next));
  return out;
}

/**
 * Compare the live version's models with the next version's (Ruling E9).
 * Additive changes (new optional fields, new operations, new models) are fine;
 * everything else is listed in `breaking`.
 */
export function compareModels(live: ModelSpec[], next: ModelSpec[]): CompatResult {
  const breaking: Breaking[] = [];
  const unreadable: string[] = [];
  const nextByType = new Map(next.map((m) => [m.documentType, m]));
  for (const liveModel of live) {
    const model = liveModel.documentType;
    const nextModel = nextByType.get(model);
    if (!nextModel) {
      breaking.push({ model, what: `${quoted(model)} was removed` });
      continue;
    }
    const state = compareFragments(liveModel.stateSchema, nextModel.stateSchema, true);
    if (state === null) unreadable.push(`${model} state`);
    for (const what of state ?? []) breaking.push({ model, what });
    const nextOps = new Map(nextModel.operations.map((o) => [o.name, o]));
    for (const op of liveModel.operations) {
      const nextOp = nextOps.get(op.name);
      if (!nextOp) {
        breaking.push({ model, what: `operation ${quoted(op.name)} was removed` });
        continue;
      }
      const input = compareFragments(op.inputSchema, nextOp.inputSchema, false);
      if (input === null) unreadable.push(`${model} operation ${op.name}`);
      for (const what of input ?? []) breaking.push({ model, what: `operation ${quoted(op.name)}: ${what}` });
    }
  }
  return { breaking, unreadable };
}

/* ------------------------------------------------------------------------ */
/* Reading models                                                            */
/* ------------------------------------------------------------------------ */

/** `<project>/document-models/<name>/<name>.json`, never under node_modules. */
const MODEL_FILE = /(?:^|\/)document-models\/([^/]+)\/\1\.json$/;

function isModelFile(file: string): boolean {
  return MODEL_FILE.test(file) && !file.split("/").includes("node_modules");
}

interface ModelJson {
  id?: unknown;
  specifications?: Array<{
    version?: number;
    state?: { global?: { schema?: string | null }; local?: { schema?: string | null } };
    modules?: Array<{ operations?: Array<{ name?: string | null; schema?: string | null }> }>;
  }>;
}

/** The latest specification of a model JSON as a ModelSpec; null when it isn't one. */
export function toModelSpec(text: string): ModelSpec | null {
  let json: ModelJson;
  try {
    json = JSON.parse(text) as ModelJson;
  } catch {
    return null;
  }
  if (typeof json.id !== "string" || !json.id || !Array.isArray(json.specifications)) return null;
  const spec = [...json.specifications].sort((x, y) => (x.version ?? 0) - (y.version ?? 0)).at(-1);
  if (!spec) return null;
  const stateSchema = [spec.state?.global?.schema, spec.state?.local?.schema]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .join("\n");
  const operations = (spec.modules ?? []).flatMap((m) =>
    (m.operations ?? [])
      .filter((o) => typeof o.name === "string" && o.name)
      .map((o) => ({ name: o.name as string, inputSchema: o.schema ?? "" })),
  );
  return { documentType: json.id, stateSchema, operations };
}

async function git(workdir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.quotepath=false", ...workspaceSafeDirectory(workdir), ...args],
    { cwd: workdir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

function collect(texts: Array<string | null>): ModelSpec[] {
  return texts.map((t) => (t === null ? null : toModelSpec(t))).filter((m): m is ModelSpec => m !== null);
}

/** The document models of the workspace at a git ref (a version tag). */
export async function readModelSpecs(workdir: string, ref: string): Promise<ModelSpec[]> {
  const files = (await git(workdir, ["ls-tree", "-r", "-z", "--name-only", ref]))
    .split("\0")
    .filter(isModelFile);
  return collect(await Promise.all(files.map((f) => git(workdir, ["show", `${ref}:${f}`]))));
}

/** The document models the next snapshot would commit (tracked and new files). */
export async function readWorkingModelSpecs(workdir: string): Promise<ModelSpec[]> {
  const files = (await git(workdir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(isModelFile);
  return collect(
    await Promise.all(files.map((f) => readFile(path.join(workdir, f), "utf-8").catch(() => null))),
  );
}

/** The gate: the working tree against the live version's tag. */
export async function checkLaunchCompat(workdir: string, liveTag: string): Promise<CompatResult> {
  const [live, next] = await Promise.all([readModelSpecs(workdir, liveTag), readWorkingModelSpecs(workdir)]);
  return compareModels(live, next);
}

/* ------------------------------------------------------------------------ */
/* Telling the agent                                                         */
/* ------------------------------------------------------------------------ */

interface ChatClient {
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
}

/**
 * Write `text` into a chat session as a user message (the agent picks it up),
 * marked as the Studio's note so the story never shows it as the customer's.
 */
export async function messageAgent(ctx: ProductContext, chatSessionId: string, text: string, at: string): Promise<void> {
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) throw new Error("no reactor to reach the chat");
  const client = drive.reactor.client as ChatClient;
  await client.execute(chatSessionId, "main", [
    chatActions.addUserMessage({
      id: `${STUDIO_NOTE_ID_PREFIX}${randomUUID()}`,
      createdAt: at,
      content: [{ id: randomUUID(), type: "TEXT", text }],
    }),
  ]);
}
