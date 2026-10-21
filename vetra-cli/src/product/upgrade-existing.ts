/**
 * Existing Studios open in the new experience (spec §6.6, G11).
 *
 * A Studio made before the product page has conversations, maybe reactor
 * projects and maybe an environment it deployed to, but no product document,
 * so the page keeps today's view for it (`studioState` 'legacy', Ruling F4).
 * Once per Studio, at startup, `adoptExisting` gives it a product document
 * made from what is there:
 *
 * - name from the drive name (the old page's header);
 * - `INIT_PRODUCT`, then `ADOPT_EXISTING` (Ruling F5): one CLOSED
 *   BEFORE_VERSIONS change holding the old conversations, PLAN/DATA/EDITORS
 *   ✓ when the workspace has them, Tests ○ (no gated ops, no check runs);
 * - when exactly one environment of the owner (not a Studio) runs the
 *   workspace's packages, `SET_LIVE_BEFORE_VERSIONS`: the page shows it as
 *   "Live (set up before versions)" until Version 1.
 *
 * The upgrade only adds: the product document, the workspace git repository
 * when there is none (`ensureWorkspaceRepo`, no tags until the first launch)
 * and, where nothing names one, the package registry the launch publishes to
 * (Ruling R25). Conversations, specs, projects and environments are never
 * changed. A failure writes nothing to the drive and leaves today's view; the
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
import { findRegistryUrl } from "../cloud/registry-url.js";
import { listMyEnvironments, type ReadContext } from "../cloud/environments-read.js";
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
/**
 * Ruling R25: where a Studio on a known stack publishes when nothing names a
 * registry (the older prod Studios have no PH_REGISTRY_URL). Keyed by the
 * cloud switchboard's host.
 */
export const STACK_REGISTRIES: Readonly<Record<string, string>> = {
  [`switchboard.${CLOUD_BASE_DOMAIN}`]: `https://registry.${CLOUD_BASE_DOMAIN}`,
};
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
}

export interface UpgradeDeps {
  ensureWorkspaceRepo: (workdir: string) => Promise<void>;
  listProjects: (workdir: string) => Promise<string[]>;
  /** The owner's environments (not Studios) that run any of `packageNames`. */
  findLiveEnvironments: (ctx: UpgradeContext, packageNames: string[]) => Promise<LiveCandidate[]>;
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

/**
 * The owner's environments that run any of the workspace's packages: never
 * the Studio itself or another Studio, never one that is gone. Throws when
 * the cloud can't be read (not signed in, offline): the caller decides later.
 */
export async function findOwnerEnvironmentsRunning(
  ctx: UpgradeContext,
  packageNames: string[],
): Promise<LiveCandidate[]> {
  if (packageNames.length === 0) return [];
  const read = ctx as unknown as ReadContext;
  const wanted = new Set(packageNames);
  const studioId = ctx.config.environmentId?.trim() ?? null;
  const out: LiveCandidate[] = [];
  for (const env of await listMyEnvironments(read, "MINE")) {
    if (env.id === studioId) continue;
    if (env.status && GONE_STATUSES.has(env.status)) continue;
    const state = await loadEnvironmentState(read, env.id);
    if (GONE_STATUSES.has(state.status)) continue;
    const installed = state.packages.map((p) => p.name);
    if (isStudioEnvironment(installed)) continue;
    if (!installed.some((n) => wanted.has(n))) continue;
    const url = environmentUrl(state);
    if (url) out.push({ environmentId: env.id, url });
  }
  return out;
}

type LiveFinding =
  | { check: "one"; env: LiveCandidate }
  | { check: "none" }
  | { check: "many"; ids: string[] };

async function findLive(ctx: UpgradeContext, projects: string[]): Promise<LiveFinding> {
  const names = workspacePackages(ctx.workdir, projects);
  const found = await depsOf(ctx).findLiveEnvironments(ctx, names);
  if (found.length === 1) return { check: "one", env: found[0] };
  if (found.length === 0) return { check: "none" };
  return { check: "many", ids: found.map((e) => e.environmentId) };
}

/* ------------------------------------------------------------------------ */
/* Registry (Ruling R25)                                                     */
/* ------------------------------------------------------------------------ */

/** The registry of the Studio's stack, or null when the stack isn't known. */
export function stackRegistry(config: UpgradeContext["config"]): string | null {
  const url = config.cloudSwitchboardUrl?.trim();
  if (!url) return null;
  try {
    return STACK_REGISTRIES[new URL(url).hostname] ?? null;
  } catch {
    return null;
  }
}

/**
 * Give every project the registry the launch publishes to when nothing names
 * one (flag, PH_REGISTRY_URL or its powerhouse.config.json): adds
 * `packageRegistryUrl` to that project's config, nothing else. Returns the
 * projects it set.
 */
export function ensureLaunchRegistry(ctx: UpgradeContext, projects: string[]): string[] {
  const set: string[] = [];
  const missing = projects.filter(
    (p) =>
      !findRegistryUrl({
        registry: ctx.config.registryUrl,
        projectPath: path.join(ctx.workdir, p),
        env: ctx.env,
      }),
  );
  if (missing.length === 0) return set;
  const registry = stackRegistry(ctx.config);
  if (!registry) {
    ctx.log?.warn?.(
      `${TAG} no package registry is set for ${missing.join(", ")} and this Studio's stack has no known one; the first launch will say so`,
    );
    return set;
  }
  for (const p of missing) {
    const file = path.join(ctx.workdir, p, "powerhouse.config.json");
    try {
      const config = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      config.packageRegistryUrl = registry;
      fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
      set.push(p);
    } catch (err) {
      ctx.log?.warn?.(`${TAG} couldn't set the package registry for ${p}: ${message(err)}`);
    }
  }
  if (set.length > 0) ctx.log?.info?.(`${TAG} package registry ${registry} set for ${set.join(", ")}`);
  return set;
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
      `${TAG} several environments run this workspace (${live.ids.join(", ")}); Version 1 gets a new address and they stay as they are`,
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
    if (existing.state.changes.length > 0) return "skipped";
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
  await d.ensureWorkspaceRepo(ctx.workdir);
  ensureLaunchRegistry(ctx, projects);

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
    const doc = withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy");
    doc.header.name = name;
    productId = (await client.createDocumentInDrive(drive.driveId, doc)).header.id;
  }
  await dispatchProduct(ctx, actions);

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

/** True for a product made by `adoptExisting` that has no version yet. */
function adoptedWithoutVersions(state: StudioProductState): boolean {
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
    throw new LaunchError(
      "CLOUD_UNAVAILABLE",
      REASONS.ensureStudioProduct,
      `checking which environment runs this workspace: ${message(err)}`,
    );
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
 * Runs the upgrade once per process, at the first poll, detached from the
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
    // Only with a running reactor (never boots one on a one-shot run).
    if (!ctx.folders || state.running) return null;
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
