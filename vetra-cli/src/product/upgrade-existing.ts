/**
 * Existing Studios open in the new experience (spec §6.6, G11).
 *
 * A Studio made before the product page has conversations, maybe reactor
 * projects and maybe an environment it deployed to, but no product document,
 * so the page keeps today's view for it (`studioState` 'legacy', Ruling F4).
 * In a Studio only (an environment id is configured), once per start of the
 * agent process, `adoptExisting` gives it a product document made from what
 * is there (a Studio already upgraded is skipped):
 *
 * - name from the drive name (the old page's header);
 * - `INIT_PRODUCT`, then `ADOPT_EXISTING` (Ruling F5): one CLOSED
 *   BEFORE_VERSIONS change holding the old conversations, PLAN/DATA/EDITORS
 *   ✓ when the workspace has them, Tests ○ (no gated ops, no check runs);
 * - when exactly one environment of the owner (not a Studio) runs the
 *   workspace's packages, `SET_LIVE_BEFORE_VERSIONS`: the page shows it as
 *   "Live (set up before versions)" until Version 1.
 *
 * The upgrade only adds: the product document and the workspace git
 * repository when there is none (`ensureWorkspaceRepo`, no tags until the
 * first launch). Conversations, specs, projects (their files included) and
 * environments are never changed; a Studio without a named registry publishes
 * to its stack's at launch time (Ruling R25, `resolveLaunchRegistryUrl`). A failure writes nothing to the drive and leaves today's view; the
 * reason is logged and the next start tries again.
 *
 * The first launch makes Version 1 through `ensureStudioProduct`. All reactor
 * projects ship together. When exactly one environment qualifies it is
 * adopted as the product's production environment (`adoptEnvironmentId`,
 * Ruling F28) so its address keeps updating; when the choice is ambiguous or
 * the cloud refuses it, the product gets a new address and the old
 * environments stay as they are, listed in Settings › Advanced (E10). Which
 * path a Studio took is logged and kept in `.ph/upgrade-existing.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withSignaturePolicy, type Action } from "document-model";
import {
  CLOUD_BASE_DOMAIN,
  isStudioEnvironment,
  type VetraCloudEnvironmentGlobalState,
} from "@powerhousedao/vetra-cloud-client";
import type { StudioProductState, StepKind } from "vetra-app/document-models/studio-product";
import { StudioProductV1 } from "vetra-app/document-models";
import type { Config } from "../framework.js";
import { defineTrigger } from "../framework.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { listReactorProjects } from "../helpers/project.js";
import { resolveLaunchRegistryUrl } from "../cloud/registry-url.js";
import {
  NOT_AUTHENTICATED,
  listMyEnvironments,
  type ReadContext,
} from "../cloud/environments-read.js";
import { loadEnvironmentState } from "../cloud/environments-write.js";
import { ensureWorkspaceRepo } from "../launch/git-versions.js";
import { LaunchError } from "../launch/errors.js";
import { REASONS, type ProductTarget } from "../launch/cloud-launch.js";
import {
  STUDIO_PRODUCT_TYPE,
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "./product-doc.js";

const TAG = "[upgrade]";

export const CHAT_SESSION_TYPE = "powerhouse/chat-session";
/** The builder spec documents the old page lists as projects (vetra-app SPECIFY_TYPES). */
export const PROJECT_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "powerhouse/document-model",
  "powerhouse/document-editor",
  "powerhouse/processor",
  "powerhouse/subgraph",
  "powerhouse/app",
]);
/**
 * The drive file name of a product document the upgrade has created but not
 * yet filled; the Studio page shows today's view for it (same literal in
 * vetra-app `startProduct.ts`).
 */
export const UPGRADING_PRODUCT_NAME = "Product (upgrading)";
/** The request of the BEFORE_VERSIONS change (the chapter's heading words). */
export const BEFORE_VERSIONS_REQUEST = "Before versions";
/** The drive name every Studio starts with; not a product name. */
const DEFAULT_DRIVE_NAME = "home";
/** A product name when nothing better is known. */
export const FALLBACK_NAME = "My product";
/** The idea stored for an adopted product is cut to this many characters. */
export const IDEA_MAX = 500;
/** Environment statuses that no longer serve anything. */
const GONE_STATUSES = new Set(["ARCHIVED", "DESTROYED", "TERMINATING", "DRAFT"]);
/** The record of what the upgrade did, next to the launch record. */
export const UPGRADE_RECORD = path.join(".ph", "upgrade-existing.json");
/** How often a live check that couldn't run is tried again. */
export const LIVE_RETRY_MS = 10 * 60_000;

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

/** An environment that runs the workspace's packages. */
export interface LiveCandidate {
  environmentId: string;
  url: string;
  /** Why it can't be adopted as it is (other packages, another registry). */
  mismatch?: string;
}

/** The workspace's packages and the registries they publish to (when known). */
export interface WorkspacePackages {
  names: string[];
  registries: string[];
}

export interface UpgradeDeps {
  ensureWorkspaceRepo: (
    workdir: string,
    opts?: { log?: { info?: (msg: string) => void } },
  ) => Promise<void>;
  listProjects: (workdir: string) => Promise<string[]>;
  /** The owner's environments (not Studios) that run any of the workspace's packages. */
  findLiveEnvironments: (ctx: UpgradeContext, workspace: WorkspacePackages) => Promise<LiveCandidate[]>;
  newId: () => string;
}

export interface UpgradeContext extends ProductContext {
  workdir: string;
  config: Pick<
    Config,
    "cloudSwitchboardUrl" | "cloudRenownUrl" | "environmentId" | "registryUrl"
  >;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  /** Seams for tests (its own key: the launch context has `deps` of its own). */
  upgradeDeps?: Partial<UpgradeDeps>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

const defaultDeps: UpgradeDeps = {
  ensureWorkspaceRepo,
  listProjects: listReactorProjects,
  findLiveEnvironments: findOwnerEnvironmentsRunning,
  newId: randomUUID,
};

function depsOf(ctx: UpgradeContext): UpgradeDeps {
  return { ...defaultDeps, ...ctx.upgradeDeps };
}

function nowIso(ctx: UpgradeContext): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------------ */
/* Record                                                                    */
/* ------------------------------------------------------------------------ */

/** What the live check found: one environment, none, several, or not yet known. */
export type LiveCheck = "one" | "none" | "many" | "pending";

export interface UpgradeRecord {
  productId?: string;
  upgradedAt?: string;
  live?: LiveCheck;
  candidates?: string[];
  /** The first launch's choice (F28 adopt, or E10 new address). */
  liveTarget?: {
    path: "adopted" | "new";
    environmentId: string | null;
    reason: string;
    at: string;
  };
}

export function readUpgradeRecord(workdir: string): UpgradeRecord {
  try {
    return JSON.parse(fs.readFileSync(path.join(workdir, UPGRADE_RECORD), "utf-8")) as UpgradeRecord;
  } catch {
    return {};
  }
}

function writeUpgradeRecord(ctx: UpgradeContext, patch: UpgradeRecord): void {
  try {
    const file = path.join(ctx.workdir, UPGRADE_RECORD);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...readUpgradeRecord(ctx.workdir), ...patch }, null, 2));
  } catch (err) {
    ctx.log?.warn?.(`${TAG} couldn't keep the upgrade record: ${message(err)}`);
  }
}

/* ------------------------------------------------------------------------ */
/* Reading what the Studio has                                               */
/* ------------------------------------------------------------------------ */

interface DriveNode {
  id: string;
  kind: string;
  name?: string;
  documentType?: string;
}

interface UpgradeClient {
  get(documentId: string): Promise<unknown>;
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
  createDocumentInDrive(driveId: string, document: unknown): Promise<{ header: { id: string } }>;
}

interface ChatMessageLike {
  role?: string;
  content?: { type?: string; text?: string | null }[];
}

interface SessionInfo {
  id: string;
  createdAt: string;
  messages: ChatMessageLike[];
}

async function readDocument(client: UpgradeClient, id: string): Promise<unknown> {
  try {
    return await client.get(id);
  } catch {
    return undefined;
  }
}

/** The drive's conversations that have messages, oldest first. */
async function oldSessions(client: UpgradeClient, nodes: DriveNode[]): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  for (const node of nodes) {
    if (node.kind !== "file" || node.documentType !== CHAT_SESSION_TYPE) continue;
    const doc = (await readDocument(client, node.id)) as
      | {
          header?: { createdAtUtcIso?: string };
          state?: { global?: { messages?: ChatMessageLike[]; startedAt?: string | null } };
        }
      | undefined;
    const messages = doc?.state?.global?.messages ?? [];
    if (messages.length === 0) continue;
    sessions.push({
      id: node.id,
      createdAt: doc?.header?.createdAtUtcIso ?? doc?.state?.global?.startedAt ?? "",
      messages,
    });
  }
  // Stable: drive order breaks ties.
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((x, y) => x.s.createdAt.localeCompare(y.s.createdAt) || x.i - y.i)
    .map(({ s }) => s);
}

function firstUserText(sessions: SessionInfo[]): string | null {
  for (const session of sessions) {
    const first = session.messages.find((m) => m.role === "USER");
    const text = (first?.content ?? [])
      .map((p) => (p.type === "TEXT" && p.text ? p.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > IDEA_MAX ? `${text.slice(0, IDEA_MAX - 1)}…` : text;
  }
  return null;
}

function hasSubdirectory(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());
  } catch {
    return false;
  }
}

/** PLAN/DATA/EDITORS done for the work the workspace already has (F5). */
export function doneStepsFor(
  workdir: string,
  projects: string[],
  projectDocuments: number,
): StepKind[] {
  const data = projects.some((p) => hasSubdirectory(path.join(workdir, p, "document-models")));
  const editors = projects.some(
    (p) =>
      hasSubdirectory(path.join(workdir, p, "editors")) ||
      hasSubdirectory(path.join(workdir, p, "apps")),
  );
  const plan = projects.length > 0 || projectDocuments > 0 || data || editors;
  const steps: StepKind[] = [];
  if (plan) steps.push("PLAN");
  if (data) steps.push("DATA");
  if (editors) steps.push("EDITORS");
  return steps;
}

/** "task-board" → "Task board". */
function humanize(dir: string): string {
  const words = dir.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** The product name: the drive name, unless it is still the default one. */
export function productNameFor(
  driveName: string | null,
  projects: string[],
  idea: string | null,
): string {
  const drive = driveName?.trim() ?? "";
  if (drive && drive.toLowerCase() !== DEFAULT_DRIVE_NAME) return drive;
  const project = projects.map(humanize).find(Boolean);
  if (project) return project;
  if (idea) {
    const words = idea.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
    if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return FALLBACK_NAME;
}

/** The workspace's package names (each reactor project's package.json). */
export function workspacePackages(workdir: string, projects: string[]): string[] {
  const names: string[] = [];
  for (const p of projects) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workdir, p, "package.json"), "utf-8")) as {
        name?: unknown;
      };
      if (typeof pkg.name === "string" && pkg.name.trim()) names.push(pkg.name.trim());
    } catch {
      // A project without a readable package.json has nothing published.
    }
  }
  return names;
}

/* ------------------------------------------------------------------------ */
/* The environment that was live before versions                             */
/* ------------------------------------------------------------------------ */

/** The address customers open: Connect at the apex, else its own host. */
export function environmentUrl(state: VetraCloudEnvironmentGlobalState): string | null {
  const sub = state.genericSubdomain;
  if (!sub) return null;
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  if (state.apexService === "CONNECT") return `https://${sub}.${base}`;
  const connect = state.services.find((s) => s.type === "CONNECT" && s.enabled);
  return connect ? `https://${sub}-${connect.prefix}.${base}` : `https://${sub}.${base}`;
}

const GONE_HTTP_STATUSES = new Set([404, 410]);
const GONE_CODES = new Set(["NOT_FOUND", "DOCUMENT_NOT_FOUND", "GONE"]);
/**
 * Gone in words, said of a document or an environment ("Document not found:
 * x", "Environment x does not exist"); any other "not found" (a user, a
 * credential) isn't. `\b` keeps a DNS failure (`ENOTFOUND`) out.
 */
const GONE_WORDS =
  /\b(?:document|environment)\b[^.;\n]{0,80}?\b(?:not[ _-]?found|does not exist|doesn't exist|has been deleted)\b|\bno such (?:document|environment)\b/i;
/** 404/410 only where a message states an HTTP status, never in ports or ids. */
const GONE_HTTP_TEXT = /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?:?)\s*(?:404|410)\b|^(?:404|410)\s+(?:not found|gone)\b/i;

function goneStatus(value: unknown): boolean {
  return typeof value === "number" && GONE_HTTP_STATUSES.has(value);
}

function goneCode(value: unknown): boolean {
  return typeof value === "string" && GONE_CODES.has(value.toUpperCase());
}

/**
 * An error that says the environment document is gone (not a passing
 * failure): its words, an HTTP 404/410 status (stated in the message, or on
 * the error, its response or its cause) or a GraphQL not-found code.
 */
export function isGoneError(err: unknown): boolean {
  return goneAt(err, 0);
}

function goneAt(err: unknown, depth: number): boolean {
  if (depth > 3) return false;
  const text = message(err);
  if (GONE_WORDS.test(text) || GONE_HTTP_TEXT.test(text)) return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    extensions?: { code?: unknown };
    graphQLErrors?: unknown;
    errors?: unknown;
    cause?: unknown;
  };
  if (goneStatus(e.status) || goneStatus(e.statusCode) || goneStatus(e.response?.status)) return true;
  if (goneCode(e.extensions?.code)) return true;
  for (const list of [e.graphQLErrors, e.errors]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as { extensions?: { code?: unknown } }[]) {
      if (goneCode(item?.extensions?.code)) return true;
    }
  }
  return e.cause !== undefined && goneAt(e.cause, depth + 1);
}

/** Packages the platform installs itself; they don't make an env someone else's. */
function isSystemPackage(name: string): boolean {
  return name.startsWith("@powerhousedao/");
}

function sameRegistry(x: string, y: string): boolean {
  return x.trim().replace(/\/+$/, "") === y.trim().replace(/\/+$/, "");
}

/** Why `state` can't simply become the product's environment, or null. */
function mismatchOf(state: VetraCloudEnvironmentGlobalState, workspace: WorkspacePackages): string | null {
  const wanted = new Set(workspace.names);
  const others = state.packages.filter((p) => !isSystemPackage(p.name) && !wanted.has(p.name));
  if (others.length > 0) return `it also runs ${others.map((p) => p.name).join(", ")}`;
  if (workspace.registries.length > 0) {
    const foreign = state.packages.filter(
      (p) => wanted.has(p.name) && p.registry && !workspace.registries.some((r) => sameRegistry(r, p.registry)),
    );
    if (foreign.length > 0) return `${foreign.map((p) => p.name).join(", ")} comes from another registry`;
  }
  return null;
}

/**
 * The owner's environments that run any of the workspace's packages: never
 * the Studio itself or another Studio, never one that is gone. One that also
 * runs other packages, or the workspace's from another registry, is listed
 * with its `mismatch` (it makes the choice ambiguous). An environment whose
 * document is clearly gone is skipped. Throws when the list or any other
 * environment can't be read (not signed in, offline, 5xx): the caller treats
 * the answer as pending and tries again later.
 */
export async function findOwnerEnvironmentsRunning(
  ctx: UpgradeContext,
  workspace: WorkspacePackages,
): Promise<LiveCandidate[]> {
  if (workspace.names.length === 0) return [];
  const read = ctx as unknown as ReadContext;
  const wanted = new Set(workspace.names);
  const studioId = ctx.config.environmentId?.trim() ?? null;
  const out: LiveCandidate[] = [];
  for (const env of await listMyEnvironments(read, "MINE")) {
    if (env.id === studioId) continue;
    if (env.status && GONE_STATUSES.has(env.status)) continue;
    let state: VetraCloudEnvironmentGlobalState;
    try {
      state = await loadEnvironmentState(read, env.id);
    } catch (err) {
      // Only an env that is clearly gone is left out; anything else (not
      // signed in, network, 5xx) leaves the answer pending for a retry, so a
      // half-read list never changes which env is adopted.
      if (!isGoneError(err)) throw err;
      ctx.log?.warn?.(`${TAG} skipped environment ${env.id}: it no longer exists (${message(err)})`);
      continue;
    }
    if (GONE_STATUSES.has(state.status)) continue;
    const installed = state.packages.map((p) => p.name);
    if (isStudioEnvironment(installed)) continue;
    if (!installed.some((n) => wanted.has(n))) continue;
    const url = environmentUrl(state);
    if (!url) continue;
    const mismatch = mismatchOf(state, workspace);
    out.push(mismatch ? { environmentId: env.id, url, mismatch } : { environmentId: env.id, url });
  }
  return out;
}

type LiveFinding =
  | { check: "one"; env: LiveCandidate }
  | { check: "none" }
  | { check: "many"; ids: string[] };

/** Where each project publishes at launch, when that can be told now. */
function workspaceRegistries(ctx: UpgradeContext, projects: string[]): string[] {
  const out = new Set<string>();
  for (const p of projects) {
    try {
      out.add(
        resolveLaunchRegistryUrl({
          registry: ctx.config.registryUrl,
          projectPath: path.join(ctx.workdir, p),
          env: ctx.env,
          environmentId: ctx.config.environmentId,
          cloudSwitchboardUrl: ctx.config.cloudSwitchboardUrl,
        }),
      );
    } catch {
      // Not determinable: the registry isn't compared.
    }
  }
  return [...out];
}

async function findLive(ctx: UpgradeContext, projects: string[]): Promise<LiveFinding> {
  const workspace = {
    names: workspacePackages(ctx.workdir, projects),
    registries: workspaceRegistries(ctx, projects),
  };
  const found = await depsOf(ctx).findLiveEnvironments(ctx, workspace);
  for (const e of found) {
    if (e.mismatch) ctx.log?.info?.(`${TAG} environment ${e.environmentId} isn't adopted as it is: ${e.mismatch}`);
  }
  if (found.length === 0) return { check: "none" };
  // Exactly one, running only this workspace: anything else is ambiguous (E10).
  if (found.length === 1 && !found[0].mismatch) return { check: "one", env: found[0] };
  return { check: "many", ids: found.map((e) => e.environmentId) };
}

/* ------------------------------------------------------------------------ */
/* The upgrade                                                               */
/* ------------------------------------------------------------------------ */

function liveAction(env: LiveCandidate, at: string): Action {
  return a.setLiveBeforeVersions({ environmentId: env.environmentId, url: env.url, at });
}

function logLive(ctx: UpgradeContext, live: LiveFinding | null): void {
  if (!live) return;
  if (live.check === "one") {
    ctx.log?.info?.(
      `${TAG} ${live.env.url} (environment ${live.env.environmentId}) runs this workspace: shown as live before versions; Version 1 goes there`,
    );
  } else if (live.check === "many") {
    ctx.log?.info?.(
      `${TAG} no single environment runs only this workspace (${live.ids.join(", ")}); Version 1 gets a new address and they stay as they are`,
    );
  }
}

/**
 * Give an existing Studio its product document (spec §6.6). Returns
 * `skipped` when there is nothing to do: no running reactor, a product that
 * already has changes, or a Studio with no work yet (it starts from the idea
 * screen). A product document without changes on a Studio with old work is a
 * half-done upgrade and is completed. Throws when a step fails; nothing is
 * written to the drive before every check has passed.
 */
export async function adoptExisting(ctx: UpgradeContext): Promise<"created" | "skipped"> {
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return "skipped";
  const client = drive.reactor.client as unknown as UpgradeClient;
  const driveDoc = (await client.get(drive.driveId)) as {
    header?: { name?: string };
    state?: { global?: { name?: string; nodes?: DriveNode[] } };
  };
  const nodes = driveDoc?.state?.global?.nodes ?? [];
  const productNode = nodes.find((n) => n.kind === "file" && n.documentType === STUDIO_PRODUCT_TYPE);
  let initialised = false;
  if (productNode) {
    const existing = await getProductDoc(ctx);
    if (!existing) throw new Error("The product document couldn't be read.");
    if (existing.state.changes.length > 0) {
      // Already upgraded; a file that still carries the upgrade's name gets
      // the product's.
      if (productNode.name === UPGRADING_PRODUCT_NAME) {
        await renameProductFile(ctx, client, drive.driveId, productNode.id, existing.state.name ?? null);
      }
      return "skipped";
    }
    initialised = existing.state.createdAt !== null || existing.state.idea !== null;
  }

  const d = depsOf(ctx);
  const projects = await d.listProjects(ctx.workdir);
  const projectDocuments = nodes.filter(
    (n) => n.kind === "file" && PROJECT_DOCUMENT_TYPES.has(n.documentType ?? ""),
  ).length;
  const sessions = await oldSessions(client, nodes);
  if (projects.length === 0 && projectDocuments === 0 && sessions.length === 0) return "skipped";

  // Everything the launch needs first; a failure here leaves today's view.
  await d.ensureWorkspaceRepo(ctx.workdir, { log: ctx.log });

  let live: LiveFinding | null = null;
  try {
    live = await findLive(ctx, projects);
  } catch (err) {
    ctx.log?.warn?.(
      `${TAG} couldn't check which environment runs this workspace yet (tried again later): ${message(err)}`,
    );
  }

  const at = nowIso(ctx);
  const idea = firstUserText(sessions);
  const driveName = driveDoc?.state?.global?.name?.trim() || driveDoc?.header?.name?.trim() || null;
  const name = productNameFor(driveName, projects, idea);
  const actions: Action[] = [];
  if (!initialised) actions.push(a.initProduct({ name, idea: idea ?? name, createdAt: at }));
  actions.push(
    a.adoptExisting({
      changeId: d.newId(),
      request: BEFORE_VERSIONS_REQUEST,
      chatSessionIds: sessions.map((s) => s.id),
      doneSteps: doneStepsFor(ctx.workdir, projects, projectDocuments),
      at,
    }),
  );
  if (live?.check === "one") actions.push(liveAction(live.env, at));

  // The reducer's answer before anything is written (a refusal leaves no
  // empty product behind).
  const refusal = preflight(actions, initialised);
  if (refusal) throw new Error(`The product document refused the upgrade: ${refusal}`);

  let productId = productNode?.id;
  if (!productId) {
    // Created under a marker name: until its operations are in, the page
    // keeps today's view for it (vetra-app `ideaStartStatus`).
    const doc = withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy");
    doc.header.name = UPGRADING_PRODUCT_NAME;
    productId = (await client.createDocumentInDrive(drive.driveId, doc)).header.id;
  }
  await dispatchProduct(ctx, actions);
  await renameProductFile(ctx, client, drive.driveId, productId, name);

  writeUpgradeRecord(ctx, {
    productId,
    upgradedAt: at,
    live: live?.check ?? "pending",
    candidates:
      live?.check === "one" ? [live.env.environmentId] : live?.check === "many" ? live.ids : [],
  });
  ctx.log?.info?.(
    `${TAG} this Studio now opens in the product page: "${name}", ${sessions.length} conversation(s) and ${projects.length} project(s) kept as the work before versions`,
  );
  logLive(ctx, live);
  return "created";
}

/** The first reducer refusal `actions` meet on a new product, or null. */
function preflight(actions: Action[], initialised: boolean): string | null {
  let doc = StudioProductV1.utils.createDocument();
  if (initialised) {
    doc = StudioProductV1.reducer(
      doc,
      a.initProduct({ name: "n", idea: "i", createdAt: new Date(0).toISOString() }),
    );
  }
  const before = doc.operations.global.length;
  for (const action of actions) doc = StudioProductV1.reducer(doc, action);
  const failed = doc.operations.global.slice(before).find((op) => op.error);
  return failed?.error ?? null;
}

/** Gives the product's drive file its name (best effort; logged on failure). */
async function renameProductFile(
  ctx: UpgradeContext,
  client: UpgradeClient,
  driveId: string,
  productId: string,
  name: string | null,
): Promise<void> {
  try {
    const { updateNode } = await import("@powerhousedao/shared/document-drive");
    await client.execute(driveId, "main", [updateNode({ id: productId, name: name?.trim() || FALLBACK_NAME })]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the product file keeps its upgrade name: ${message(err)}`);
  }
}

/**
 * True for a product made by `adoptExisting` that has no version yet. Same
 * rule as vetra-app's `adoptedWithoutVersions`
 * (editors/vetra-studio/shell/firstVersion.ts, not importable here without the
 * editor bundle): change both together. Both run the cases in
 * vetra-app/editors/vetra-studio/shell/adoptedWithoutVersions.cases.json.
 */
export function adoptedWithoutVersions(state: StudioProductState): boolean {
  return (
    state.liveVersion == null &&
    state.versions.length === 0 &&
    state.changes.some((c) => c.kind === "BEFORE_VERSIONS")
  );
}

/**
 * Try the live check again when the upgrade couldn't run it (the owner had
 * not signed in, the cloud didn't answer). Returns what it found, or null
 * when there was nothing to check.
 */
export async function refreshLiveBeforeVersions(ctx: UpgradeContext): Promise<LiveCheck | null> {
  if (readUpgradeRecord(ctx.workdir).live !== "pending") return null;
  const product = await getProductDoc(ctx);
  if (!product) return null;
  const s = product.state;
  if (!adoptedWithoutVersions(s) || s.liveBeforeVersions || s.appId) {
    writeUpgradeRecord(ctx, { live: s.liveBeforeVersions ? "one" : "none" });
    return null;
  }
  const live = await findLive(ctx, await depsOf(ctx).listProjects(ctx.workdir));
  if (live.check === "one") await dispatchProduct(ctx, [liveAction(live.env, nowIso(ctx))]);
  writeUpgradeRecord(ctx, {
    live: live.check,
    candidates: live.check === "one" ? [live.env.environmentId] : live.check === "many" ? live.ids : [],
  });
  logLive(ctx, live);
  return live.check;
}

/* ------------------------------------------------------------------------ */
/* Version 1 of an adopted product (F28, E10)                                */
/* ------------------------------------------------------------------------ */

/**
 * The environment Version 1 should adopt, or null for a new address: the one
 * recorded as live before versions, else the one environment that runs the
 * workspace now. Throws a `LaunchError` when that can't be checked, so the
 * launch tries again later instead of making a second address.
 */
export async function adoptionFor(
  ctx: UpgradeContext,
  state: StudioProductState,
): Promise<string | null> {
  if (!adoptedWithoutVersions(state) || state.appId) return null;
  if (state.liveBeforeVersions) return state.liveBeforeVersions.environmentId;
  let live: LiveFinding;
  try {
    live = await findLive(ctx, await depsOf(ctx).listProjects(ctx.workdir));
  } catch (err) {
    const detail = `checking which environment runs this workspace: ${message(err)}`;
    // Not signed in: the owner's OK is missing (F7), not a cloud outage.
    if (message(err) === NOT_AUTHENTICATED) {
      throw new LaunchError("DELEGATION_MISSING", "your Studio needs your OK to publish", detail);
    }
    throw new LaunchError("CLOUD_UNAVAILABLE", REASONS.ensureStudioProduct, detail);
  }
  logLive(ctx, live);
  if (live.check !== "one") return null;
  try {
    await dispatchProduct(ctx, [liveAction(live.env, nowIso(ctx))]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} couldn't show ${live.env.url} as live before versions: ${message(err)}`);
  }
  return live.env.environmentId;
}

export type EnsureProduct = (
  name: string,
  opts?: { adoptEnvironmentId?: string },
) => Promise<ProductTarget>;

/**
 * The product's App + production environment for the live target. For an
 * adopted product without versions, the environment that was live before
 * versions becomes its production environment (F28); the cloud refusing it
 * (`ADOPT_NOT_ALLOWED`) falls back to a new address (E10). Records the path.
 */
export async function ensureProductTarget(
  ctx: UpgradeContext,
  state: StudioProductState,
  name: string,
  ensure: EnsureProduct,
): Promise<ProductTarget> {
  const adopt = await adoptionFor(ctx, state);
  if (!adopt) {
    const target = await ensure(name);
    if (adoptedWithoutVersions(state) && !state.appId) {
      recordPath(ctx, "new", target.productionEnvironmentId, "no single environment ran this workspace");
    }
    return target;
  }
  try {
    const target = await ensure(name, { adoptEnvironmentId: adopt });
    recordPath(ctx, "adopted", target.productionEnvironmentId, "the environment live before versions");
    return target;
  } catch (err) {
    if (!(err instanceof LaunchError) || err.code !== "ADOPT_NOT_ALLOWED") throw err;
    ctx.log?.warn?.(
      `${TAG} environment ${adopt} can't become the product's live address (${err.message}); Version 1 gets a new one and ${adopt} stays as it is`,
    );
    const target = await ensure(name);
    recordPath(ctx, "new", target.productionEnvironmentId, `environment ${adopt} was refused`);
    return target;
  }
}

function recordPath(
  ctx: UpgradeContext,
  pathTaken: "adopted" | "new",
  environmentId: string | null,
  reason: string,
): void {
  ctx.log?.info?.(
    `${TAG} Version 1 goes to ${pathTaken === "adopted" ? "the adopted" : "a new"} environment ${environmentId ?? "?"} (${reason})`,
  );
  writeUpgradeRecord(ctx, {
    liveTarget: { path: pathTaken, environmentId, reason, at: nowIso(ctx) },
  });
}

/* ------------------------------------------------------------------------ */
/* Trigger                                                                   */
/* ------------------------------------------------------------------------ */

interface UpgradeState extends Record<string, unknown> {
  started: boolean;
  running: boolean;
  lastLiveTryAt: number;
}

/** One upgrade try; never throws (the reason is logged, today's view stays). */
export async function runUpgrade(ctx: UpgradeContext): Promise<"created" | "skipped" | "failed"> {
  try {
    return await adoptExisting(ctx);
  } catch (err) {
    ctx.log?.error?.(
      `${TAG} this Studio keeps today's view for now (tried again at the next start): ${message(err)}`,
    );
    return "failed";
  }
}

/**
 * In a Studio only (`config.environmentId`), runs the upgrade once per
 * process, at the first poll, detached from the
 * shared trigger loop so the agent's turn and the other triggers never wait
 * on it. A live check the upgrade couldn't run is tried again every
 * `LIVE_RETRY_MS`.
 */
export const existingStudioUpgradeTrigger = defineTrigger<UpgradeState>({
  id: "existing-studio-upgrade",
  type: "condition",
  state: () => ({ started: false, running: false, lastLiveTryAt: 0 }),

  async poll(tctx) {
    const state = tctx.state;
    const ctx = tctx.commandContext as unknown as UpgradeContext;
    // Only in a Studio (an environment id), with a running reactor (never
    // boots one on a one-shot run).
    if (!ctx.folders || !ctx.config?.environmentId || state.running) return null;
    const nowMs = Date.now();
    if (state.started && nowMs - state.lastLiveTryAt < LIVE_RETRY_MS) return null;
    const first = !state.started;
    state.started = true;
    state.lastLiveTryAt = nowMs;
    state.running = true;
    const pass = first
      ? getEmbeddedDrive(ctx).then(async (drive) => {
          // The drive isn't there yet: the upgrade waits for a later poll.
          if (!drive) {
            state.started = false;
            return;
          }
          await runUpgrade(ctx);
        })
      : refreshLiveBeforeVersions(ctx).then(() => undefined);
    void pass
      .catch((err: unknown) =>
        ctx.log?.warn?.(`${TAG} live check not done yet (tried again later): ${message(err)}`),
      )
      .finally(() => {
        state.running = false;
      });
    return null;
  },
});
