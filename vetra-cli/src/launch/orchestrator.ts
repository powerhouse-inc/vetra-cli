/**
 * The launch orchestrator: puts a READY change live, step by step, recording
 * every step in the product document, and serves the browser's requests
 * (Go back, Restart, Discard, Mirror) and the access switch.
 *
 * Nothing here needs the LLM or a browser: the product-requests trigger
 * (triggers/product-requests.ts) calls these from the agent process.
 *
 * Launch of Version n (spec §6.5, Ruling F7b), each a line on the Version:
 * Before SNAPSHOT, while a version is live, the data-compatibility gate (D6,
 * compat-launch.ts) compares the document models with the live version's: a
 * change that would break live documents stops here with `FAIL_LAUNCH` (no
 * line runs) and the agent is told, in the change's conversation, to make it
 * additive.
 *   SNAPSHOT  "Saving version <n>"         commit + tag `v<n>` (detail: sha)
 *   PUBLISH   "Publishing your product"    packages (detail: name@version …)
 *   DEPLOY    "Starting your live app at <slug>.vetra.io"
 *             cloud launch (detail: deployment id) → READY → on the first
 *             launch the product drive (create + seed), `setStudioProductDrive`
 *             and `SET_PRODUCT_DRIVE`
 *   VERIFY    "Checking it's up"           HTTP check of the live address
 *   MIRROR    SKIPPED until GitHub arrives (M4)
 * then `COMPLETE_LAUNCH`. On a failure the running line is FAILED and
 * `FAIL_LAUNCH` records the plain reason (F39); a missing or expired permission
 * (F7) is the exception: the Version stays LAUNCHING, its running line goes
 * back to WAITING and `SET_LAUNCH_PERMISSION` records what the owner must do.
 * START/COMPLETE/FAIL_LAUNCH move the change's LIVE step; `product-progress
 * done LIVE` is never called.
 *
 * A launch interrupted by a restart resumes from its first line not DONE: the
 * details of the DONE lines are what it needs (F22); a DEPLOY line with a
 * deployment id waits on that deployment instead of deploying again.
 */
import fs from "node:fs";
import path from "node:path";
import { CLOUD_BASE_DOMAIN } from "@powerhousedao/vetra-cloud-client";
import type {
  Change,
  LaunchLineKind,
  LineStatus,
  ProductAccess,
  RequestKind,
  StudioProductState,
  Version,
} from "vetra-app/document-models/studio-product";
import type { Config } from "../framework.js";
import { listReactorProjects } from "../helpers/project.js";
import {
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "../product/product-doc.js";
import {
  REASONS,
  cloudLaunch,
  cloudRollback,
  cloudSetProductDrive,
  ensureProduct,
  isSecretPending,
} from "./cloud-launch.js";
import {
  COMPAT_UNCHECKED_REASON,
  agentMessage,
  breakingReason,
  checkLaunchCompat,
  messageAgent,
  type CompatResult,
} from "./compat-launch.js";
import { refreshRollbackBlocks } from "./compat-rollback.js";
import { LaunchError, launchPermissionState } from "./errors.js";
import { changedFiles, discardDraft, restoreVersion, snapshot } from "./git-versions.js";
import {
  countDriveDocuments,
  ensureProductDrive,
  markAccessAdopted,
  readProductDriveRecord,
  setAccess,
  type ProductDriveContext,
} from "./product-drive.js";
import { publishAll, type LiveRelease, type PublishedPackage } from "./publish-all.js";
import { awaitRollbackSettle } from "../triggers/live-health.js";
import { askForSuggestions, chatBudgetUsedUp, hasSuggestionsFor } from "./suggestions.js";
import { checkLive, waitForDeployment } from "./verify.js";
import { changeOwner } from "../team/change-owner.js";
import { adoptedWithoutVersions, ensureProductTarget } from "../product/upgrade-existing.js";

/* ------------------------------------------------------------------------ */
/* Words and small rules                                                     */
/* ------------------------------------------------------------------------ */

/** `COMPLETE_LAUNCH.trigger` for every launch the agent runs. */
export const LAUNCH_TRIGGER = "STUDIO_LAUNCH";
/** `launchedBy` of the automatic first launch (the Versions panel's "built by Vetra"). */
export const AUTO_LAUNCHED_BY = "vetra";
/** E6: Go back while the Studio has unsaved changes (the disabled-button copy). */
export const DRAFT_OPEN_TEXT = "Finish or discard your change first.";
/** E6 as the plain reason stored on the product (the page composes the sentence). */
export const DRAFT_OPEN_REASON = "your change isn't finished";
/** F13: a Version's title falls back to the request, cut to this many characters. */
export const VERSION_TITLE_MAX = 60;

/** Plain reasons for the steps that have no building block of their own (F39). */
export const LAUNCH_REASONS = {
  notAnswering: "your live app didn't answer",
  unexpected: "something unexpected stopped it",
  noLiveAddress: "your live address couldn't be set up",
  notReady: "your product isn't ready to go live yet",
} as const;

/** The story text of a launch line (for logs; the page composes its own copy). */
export function launchLineText(kind: LaunchLineKind, number: number, slug: string | null): string {
  switch (kind) {
    case "SNAPSHOT":
      return `Saving version ${number}`;
    case "PUBLISH":
      return "Publishing your product";
    case "DEPLOY":
      return `Starting your live app at ${slug ?? "your live address"}.${CLOUD_BASE_DOMAIN}`;
    case "VERIFY":
      return "Checking it's up";
    case "MIRROR":
      return "Saving to GitHub";
  }
}

/** The full failure line (logs only; the page composes it from the plain reason, F39). */
export function launchFailureText(reason: string, liveVersion: number | null): string {
  const plain = reason.trim().replace(/[.\s]+$/, "");
  return liveVersion === null
    ? `Couldn't go live: ${plain}. Your app isn't live yet.`
    : `Couldn't go live: ${plain}. Your live app is still on Version ${liveVersion}.`;
}

/** F13: the change's title, else its request cut to 60 characters. */
export function versionTitle(change: Pick<Change, "title" | "request"> | undefined): string {
  const title = change?.title?.trim();
  if (title) return title;
  const request = (change?.request ?? "").trim().replace(/\s+/g, " ");
  return request.length > VERSION_TITLE_MAX ? request.slice(0, VERSION_TITLE_MAX).trimEnd() : request;
}

/** The product's live server (Task 2.2: Switchboard at `<slug>-switchboard.vetra.io`). */
export function liveSwitchboardUrl(slug: string): string {
  return `https://${slug}-switchboard.${CLOUD_BASE_DOMAIN}`;
}

/**
 * The number START_LAUNCH accepts next (mirrors the reducer, F23): the lowest
 * FAILED version newer than every launched one is retried under its number.
 */
export function nextVersionNumber(state: StudioProductState): { number: number; retry: boolean } {
  const launchedMax = state.versions
    .filter((v) => v.status !== "FAILED")
    .reduce((m, v) => Math.max(m, v.number), 0);
  const retry = state.versions
    .filter((v) => v.status === "FAILED" && v.number > launchedMax)
    .reduce<number | null>((low, v) => (low !== null && low < v.number ? low : v.number), null);
  if (retry !== null) return { number: retry, retry: true };
  return { number: state.versions.reduce((m, v) => Math.max(m, v.number), 0) + 1, retry: false };
}

/**
 * The change the automatic launch should put live, or null (D3, F6, F10):
 * nothing is live, no launch is under way, and a READY change (any kind) has
 * never been launched — after a failure only "Try again" launches it.
 */
export function autoLaunchCandidate(state: StudioProductState): Change | null {
  if (state.liveVersion != null) return null;
  // X33: an existing Studio's product gets Version 1 only when the customer
  // says Make it live — also while its live check is still pending, since an
  // environment found at launch time would be adopted.
  if (adoptedWithoutVersions(state)) return null;
  if (state.versions.some((v) => v.status === "LAUNCHING")) return null;
  return (
    state.changes.find(
      (c) =>
        c.status === "READY" &&
        c.kind !== "BEFORE_VERSIONS" &&
        !state.versions.some((v) => v.changeId === c.id),
    ) ?? null
  );
}

function formatPackages(packages: PublishedPackage[]): string {
  return packages.map((p) => `${p.name}@${p.version}`).join(" ");
}

function parsePackages(detail: string): PublishedPackage[] {
  return detail
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf("@");
      return { name: entry.slice(0, at), version: entry.slice(at + 1) };
    })
    .filter((p) => p.name && p.version);
}

/** The app view of the product (the drive's preferred editor), when a project has one. */
function appEditorId(workdir: string, projects: string[]): string | null {
  for (const project of projects) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(workdir, project, "powerhouse.manifest.json"), "utf-8"),
      ) as { apps?: Array<{ id?: unknown }> };
      const id = manifest.apps?.find((app) => typeof app.id === "string")?.id;
      if (typeof id === "string") return id;
    } catch {
      // No manifest (yet): no app view.
    }
  }
  return null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

/** The building blocks a launch uses; tests replace them. */
export interface LaunchDeps {
  ensureProduct: typeof ensureProduct;
  snapshot: typeof snapshot;
  publishAll: typeof publishAll;
  cloudLaunch: typeof cloudLaunch;
  waitForDeployment: typeof waitForDeployment;
  checkLive: typeof checkLive;
  ensureProductDrive: typeof ensureProductDrive;
  cloudSetProductDrive: typeof cloudSetProductDrive;
  cloudRollback: typeof cloudRollback;
  restoreVersion: typeof restoreVersion;
  discardDraft: typeof discardDraft;
  setAccess: typeof setAccess;
  changedFiles: typeof changedFiles;
  listProjects: (workdir: string) => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  /** The short suggestions turn after a launch without suggestions (F11). */
  afterLaunch?: (ctx: OrchestratorContext, number: number) => Promise<void>;
  /** True when this month's budget is used up: the suggestions turn is skipped. */
  budgetUsedUp?: (ctx: OrchestratorContext, number: number) => Promise<boolean>;
  /** The data-compatibility gate (D6): the working tree against the live tag. */
  checkCompat?: typeof checkLaunchCompat;
  /** Writes a message into a change's conversation for the agent. */
  messageAgent?: typeof messageAgent;
  /** How many documents the live product drive holds (D6: is there live data?). */
  countDriveDocuments?: typeof countDriveDocuments;
  /** F26: which earlier versions the data can't go back to, after each launch. */
  refreshRollbackBlocks?: typeof refreshRollbackBlocks;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultDeps: LaunchDeps = {
  ensureProduct,
  snapshot,
  publishAll,
  cloudLaunch,
  waitForDeployment,
  checkLive,
  ensureProductDrive,
  cloudSetProductDrive,
  cloudRollback,
  restoreVersion,
  discardDraft,
  setAccess,
  changedFiles,
  listProjects: listReactorProjects,
  sleep: realSleep,
  checkCompat: checkLaunchCompat,
  messageAgent,
  countDriveDocuments,
  refreshRollbackBlocks,
  afterLaunch: askForSuggestions,
  budgetUsedUp: chatBudgetUsedUp,
};

export interface OrchestratorContext extends ProductContext, ProductDriveContext {
  workdir: string;
  config: Pick<
    Config,
    "cloudSwitchboardUrl" | "cloudRenownUrl" | "environmentId" | "registryUrl" | "studioOrgId" | "renownOrgsUrl"
  >;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  /** Seams for tests. */
  deps?: Partial<LaunchDeps>;
  now?: () => Date;
  /** The change owner whose delegation this launch's cloud calls carry (an
   * org Studio, task 1.11); set for the launch, cleared when it ends. */
  member?: string;
}

function depsOf(ctx: OrchestratorContext): LaunchDeps {
  return { ...defaultDeps, ...ctx.deps };
}

function nowIso(ctx: OrchestratorContext): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

/**
 * Pauses while the cloud is handing this Studio its launch secret
 * (`STUDIO_SECRET_PENDING`): the Studio restarts with it within a minute or
 * two (a restart resumes the launch, F22). About 2 min in all.
 */
export const SECRET_PENDING_WAITS_MS = [15_000, 30_000, 30_000, 45_000];

async function cloudCall<T>(ctx: OrchestratorContext, call: () => Promise<T>): Promise<T> {
  const d = depsOf(ctx);
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (err) {
      if (!isSecretPending(err) || i >= SECRET_PENDING_WAITS_MS.length) throw err;
      ctx.log?.info?.("[launch] waiting for the Studio to restart with its launch secret");
      await d.sleep(SECRET_PENDING_WAITS_MS[i]);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Live target (D8)                                                          */
/* ------------------------------------------------------------------------ */

/**
 * The product's App + production environment (`ensureStudioProduct`) recorded
 * with `SET_LIVE_TARGET`. Called in the background when the plan is done
 * (D8) and again by the launch when it is still missing. Returns the state
 * with the target; throws `LaunchError` when the cloud refuses.
 */
async function doEnsureLiveTarget(ctx: OrchestratorContext): Promise<StudioProductState> {
  const s = (await getProductDoc(ctx))!.state;
  const name = s.name?.trim();
  if (!name) {
    throw new LaunchError("NO_NAME", LAUNCH_REASONS.noLiveAddress, "The product has no name yet.");
  }
  // An existing Studio's product adopts the environment live before versions (§6.6).
  const target = await ensureProductTarget(ctx, s, name, (n, opts) =>
    cloudCall(ctx, () => depsOf(ctx).ensureProduct(ctx, n, opts)),
  );
  await dispatchProduct(ctx, [a.setLiveTarget(target)]);
  ctx.log?.info?.(`[launch] live address ${target.slug}.${CLOUD_BASE_DOMAIN} set up`);
  return (await getProductDoc(ctx))!.state;
}

let liveTargetInFlight: Promise<StudioProductState> | null = null;

/** One setup at a time: the plan-done request and the launch share it (D8). */
function sharedLiveTarget(ctx: OrchestratorContext): Promise<StudioProductState> {
  liveTargetInFlight ??= doEnsureLiveTarget(ctx).finally(() => {
    liveTargetInFlight = null;
  });
  return liveTargetInFlight;
}

export async function ensureLiveTarget(ctx: OrchestratorContext): Promise<StudioProductState> {
  const product = await getProductDoc(ctx);
  if (!product) throw new Error("There is no product document in this Studio.");
  const s = product.state;
  if (s.appId && s.slug && s.liveUrl && s.productionEnvironmentId) return s;
  return sharedLiveTarget(ctx);
}

/**
 * D8 in the background: request the App + production environment once the
 * plan is done. Never throws; a failure is logged at error and the next step
 * change tries again. Concurrent calls share one request.
 */
export function requestLiveTarget(ctx: OrchestratorContext): Promise<boolean> {
  return ensureLiveTarget(ctx)
    .then(() => true)
    .catch((err: unknown) => {
      ctx.log?.error?.(`[launch] live address not set up yet (tried again at the next step): ${message(err)}`);
      return false;
    });
}

/* ------------------------------------------------------------------------ */
/* Launch                                                                    */
/* ------------------------------------------------------------------------ */

export interface LaunchOptions {
  changeId: string;
  trigger: typeof LAUNCH_TRIGGER;
  /** Who launched: the requester, or `AUTO_LAUNCHED_BY` for the automatic first launch. */
  launchedBy?: string;
  /** Clear the waiting LAUNCH request together with START_LAUNCH (the version stands for it). */
  clearRequest?: boolean;
}

export type LaunchOutcome =
  | { status: "LIVE"; number: number }
  | { status: "FAILED"; number: number; reason: string }
  /** F7: the owner's OK is missing or ran out; the Version stays LAUNCHING. */
  | { status: "NEEDS_PERMISSION"; number: number }
  | { status: "SKIPPED"; reason: string };

/** Who and what started the launch in flight, kept for a resume after a restart. */
interface LaunchRecord {
  number: number;
  launchedBy: string;
  trigger: string;
}

const LAUNCH_RECORD = path.join(".ph", "launch.json");

function writeLaunchRecord(workdir: string, record: LaunchRecord): void {
  try {
    const file = path.join(workdir, LAUNCH_RECORD);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record));
  } catch {
    // Only the "who launched" label of a resumed launch depends on it.
  }
}

function readLaunchRecord(workdir: string, number: number): LaunchRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(workdir, LAUNCH_RECORD), "utf-8")) as LaunchRecord;
    return r.number === number && typeof r.launchedBy === "string" ? r : null;
  } catch {
    return null;
  }
}

function clearLaunchRecord(workdir: string): void {
  fs.rmSync(path.join(workdir, LAUNCH_RECORD), { force: true });
}

/**
 * Put a READY change live as the next Version (F23: a failed Version is
 * retried under its number). When the change already has a launch under way
 * it is resumed instead. Never throws: a failure is recorded with
 * `FAIL_LAUNCH` and returned.
 */
export async function launch(ctx: OrchestratorContext, opts: LaunchOptions): Promise<LaunchOutcome> {
  const product = await getProductDoc(ctx);
  if (!product) return { status: "SKIPPED", reason: "no product document" };
  const state = product.state;
  const launching = state.versions.find((v) => v.status === "LAUNCHING");
  if (launching) {
    if (launching.changeId === opts.changeId) return resumeLaunch(ctx, launching.number);
    return { status: "SKIPPED", reason: `Version ${launching.number} is being launched` };
  }
  const change = state.changes.find((c) => c.id === opts.changeId);
  if (!change || change.status !== "READY") {
    return { status: "SKIPPED", reason: `change ${opts.changeId} is ${change?.status ?? "missing"}` };
  }
  const { number, retry } = nextVersionNumber(state);
  const launchedBy = opts.launchedBy ?? AUTO_LAUNCHED_BY;
  writeLaunchRecord(ctx.workdir, { number, launchedBy, trigger: opts.trigger });
  try {
    await dispatchProduct(ctx, [
      a.startLaunch({ number, changeId: change.id, at: nowIso(ctx) }),
      ...(opts.clearRequest ? [a.clearRequest({})] : []),
    ]);
  } catch (err) {
    clearLaunchRecord(ctx.workdir);
    ctx.log?.warn?.(`[launch] Version ${number} not started: ${message(err)}`);
    return { status: "SKIPPED", reason: message(err) };
  }
  ctx.log?.info?.(`[launch] Version ${number} "${versionTitle(change)}" is going live`);
  return runLaunch(ctx, number, { allowRetag: retry, launchedBy, trigger: opts.trigger });
}

/** Resume a LAUNCHING Version from its first line not DONE (F22). */
export async function resumeLaunch(ctx: OrchestratorContext, number: number): Promise<LaunchOutcome> {
  const record = readLaunchRecord(ctx.workdir, number);
  ctx.log?.info?.(`[launch] resuming the launch of Version ${number}`);
  return runLaunch(ctx, number, {
    // A LAUNCHING version was never live: its tag may move (F23).
    allowRetag: true,
    launchedBy: record?.launchedBy ?? AUTO_LAUNCHED_BY,
    trigger: record?.trigger ?? LAUNCH_TRIGGER,
  });
}

async function runLaunch(
  ctx: OrchestratorContext,
  number: number,
  opts: { allowRetag: boolean; launchedBy: string; trigger: string },
): Promise<LaunchOutcome> {
  const d = depsOf(ctx);
  let current: LaunchLineKind | null = null;
  let liveBefore: number | null = null;
  const setLine = (kind: LaunchLineKind, status: LineStatus, detail?: string | null) =>
    dispatchProduct(ctx, [a.setLaunchLine({ number, kind, status, detail: detail ?? null })]);

  try {
    let state = (await getProductDoc(ctx))?.state;
    const version = state?.versions.find((v) => v.number === number);
    if (!state || !version || version.status !== "LAUNCHING") {
      return { status: "SKIPPED", reason: `Version ${number} is not being launched` };
    }
    liveBefore = state.liveVersion ?? null;
    const change = state.changes.find((c) => c.id === version.changeId);
    // An org Studio's cloud calls speak for the change's owner (the launch
    // requester), not for a Studio-wide identity: their own delegation only.
    if (change && ctx.config.studioOrgId) {
      try {
        const owner = await changeOwner(ctx, change);
        if (owner) ctx.member = owner.address;
      } catch (err) {
        ctx.log?.warn?.(`[launch] launch requester could not be read: ${message(err)}`);
      }
    }
    const title = versionTitle(change);
    const line = (kind: LaunchLineKind) => version.lines.find((l) => l.kind === kind);
    const isDone = (kind: LaunchLineKind) => line(kind)?.status === "DONE" && !!line(kind)?.detail;

    // The live address: normally set up when the plan was done (D8).
    state = await ensureLiveTarget(ctx);
    const { appId, slug, liveUrl } = state;
    if (!appId || !slug || !liveUrl) {
      throw new LaunchError("NO_LIVE_TARGET", LAUNCH_REASONS.noLiveAddress, "No live target after ensureLiveTarget.");
    }

    // The data-compatibility gate (D6): only while a version is live, and
    // only before the snapshot (a resumed launch past it already passed).
    const liveTag = state.versions.find((v) => v.number === state?.liveVersion)?.gitTag ?? null;
    if (liveTag && !isDone("SNAPSHOT")) {
      await compatGate(ctx, number, liveTag, change?.chatSessionId ?? null, state);
    }

    // SNAPSHOT
    let sha: string;
    let gitTag = version.gitTag;
    if (isDone("SNAPSHOT")) {
      sha = line("SNAPSHOT")!.detail!;
    } else {
      current = "SNAPSHOT";
      ctx.log?.info?.(`[launch] ${launchLineText(current, number, slug)}`);
      await setLine(current, "RUNNING");
      ({ sha, tag: gitTag } = await d.snapshot(ctx.workdir, number, title, { allowRetag: opts.allowRetag }));
      await setLine(current, "DONE", sha);
    }

    // PUBLISH (stable names: the live version's packages, X13/X24)
    let packages: PublishedPackage[];
    const liveNumber = state.liveVersion;
    const live = state.versions.find((v) => v.number === liveNumber) ?? null;
    if (isDone("PUBLISH")) {
      packages = parsePackages(line("PUBLISH")!.detail!);
    } else {
      current = "PUBLISH";
      ctx.log?.info?.(`[launch] ${launchLineText(current, number, slug)}`);
      await setLine(current, "RUNNING");
      const liveRelease: LiveRelease | null = live
        ? { tag: live.gitTag, packages: live.packages.map((p) => ({ name: p.name, version: p.version })) }
        : null;
      packages = await d.publishAll(ctx, ctx.workdir, { slug, live: liveRelease });
      await setLine(current, "DONE", formatPackages(packages));
    }

    // DEPLOY (+ the product drive on the first launch, F7b)
    let deploymentId = line("DEPLOY")?.detail ?? null;
    if (line("DEPLOY")?.status !== "DONE" || !deploymentId) {
      current = "DEPLOY";
      ctx.log?.info?.(`[launch] ${launchLineText(current, number, slug)}`);
      await setLine(current, "RUNNING", deploymentId);
      if (!deploymentId) {
        const ref = await cloudCall(ctx, () =>
          d.cloudLaunch(ctx, { appId, versionNumber: number, sha, gitTag, packages }),
        );
        deploymentId = ref.deploymentId;
        // Recorded at once: a restart waits on this deployment (F22).
        await setLine(current, "RUNNING", deploymentId);
      }
      const id = deploymentId;
      const outcome = await cloudCall(ctx, () => d.waitForDeployment(ctx, id));
      if (outcome !== "READY") {
        throw new LaunchError("DEPLOY_FAILED", outcome.failed, outcome.detail ?? outcome.failed);
      }
      if (!state.productDriveId) await openProductDrive(ctx, state, number, appId, slug);
      await setLine(current, "DONE", deploymentId);
    }

    // VERIFY
    if (line("VERIFY")?.status !== "DONE") {
      current = "VERIFY";
      ctx.log?.info?.(`[launch] ${launchLineText(current, number, slug)}`);
      await setLine(current, "RUNNING");
      if (!(await d.checkLive(liveUrl))) {
        throw new LaunchError("NOT_ANSWERING", LAUNCH_REASONS.notAnswering, `${liveUrl} did not answer 200.`);
      }
      await setLine(current, "DONE");
    }

    // MIRROR: GitHub arrives in M4.
    current = null;
    if (line("MIRROR")?.status !== "SKIPPED") await setLine("MIRROR", "SKIPPED");

    let files: string[] = [];
    try {
      files = d.changedFiles(ctx.workdir, live?.gitTag ?? null, sha);
    } catch (err) {
      ctx.log?.warn?.(`[launch] changed files not listed: ${message(err)}`);
    }
    await dispatchProduct(ctx, [
      a.completeLaunch({
        number,
        gitTag,
        sha,
        packages: packages.map((p) => ({ name: p.name, version: p.version })),
        deploymentId,
        title,
        summary: null,
        changedFiles: files,
        launchedBy: opts.launchedBy,
        trigger: opts.trigger,
        at: nowIso(ctx),
      }),
    ]);
    clearLaunchRecord(ctx.workdir);
    // A later launch settles any Go back still waiting on the cloud.
    awaitRollbackSettle(null);
    ctx.log?.info?.(`[launch] Version ${number} is live at ${liveUrl}`);
    // F26: the earlier versions' Go back is worked out again, in the
    // background (it reads the live drive; never throws).
    void (d.refreshRollbackBlocks ?? refreshRollbackBlocks)(ctx);
  } catch (err) {
    const permission = launchPermissionState(err);
    if (permission) {
      // F7: the owner's OK is missing or ran out. The Version stays LAUNCHING
      // and the running line goes back to WAITING, so the requests trigger can
      // resume it once the page records the OK (no FAIL_LAUNCH, no retry storm).
      ctx.log?.warn?.(
        `[launch] Version ${number} waits for the owner's OK to publish${current ? ` at ${current}` : ""}: ${message(err)}`,
      );
      try {
        await dispatchProduct(ctx, [
          ...(current ? [a.setLaunchLine({ number, kind: current, status: "WAITING", detail: null })] : []),
          a.setLaunchPermission({ state: permission }),
        ]);
      } catch (recordErr) {
        ctx.log?.error?.(`[launch] Version ${number}: the permission state couldn't be recorded: ${message(recordErr)}`);
      }
      return { status: "NEEDS_PERMISSION", number };
    }

    const reason = err instanceof LaunchError ? err.reason : LAUNCH_REASONS.unexpected;
    ctx.log?.error?.(
      `[launch] Version ${number} failed${current ? ` at ${current}` : ""}: ${message(err)} — ${launchFailureText(reason, liveBefore)}`,
    );
    try {
      const actions = [
        ...(current ? [a.setLaunchLine({ number, kind: current, status: "FAILED", detail: null })] : []),
        a.failLaunch({ number, reason, at: nowIso(ctx) }),
      ];
      await dispatchProduct(ctx, actions);
    } catch (recordErr) {
      ctx.log?.error?.(`[launch] Version ${number}: the failure couldn't be recorded: ${message(recordErr)}`);
    }
    clearLaunchRecord(ctx.workdir);
    // D6: the agent hears about it once the failure is on the product.
    if (err instanceof BreakingChangeError) await tellAgent(ctx, number, err);
    return { status: "FAILED", number, reason };
  }

  // F11: the agent wrote its suggestions in the Tests step; only when there
  // are none for this version, one short turn asks — never on a spent budget.
  if (d.afterLaunch) {
    try {
      const after = (await getProductDoc(ctx))?.state;
      if (after && hasSuggestionsFor(after, number)) {
        ctx.log?.debug?.(`[launch] Version ${number}: suggestions already written`);
      } else if (d.budgetUsedUp && (await d.budgetUsedUp(ctx, number))) {
        ctx.log?.info?.(`[launch] Version ${number}: budget used up, no suggestions`);
      } else {
        await d.afterLaunch(ctx, number);
      }
    } catch (err) {
      ctx.log?.warn?.(`[launch] Version ${number}: suggestions failed: ${message(err)}`);
    }
  }
  return { status: "LIVE", number };
}

/** D6: the launch would break live documents; the agent is told after FAIL_LAUNCH is recorded. */
class BreakingChangeError extends LaunchError {
  constructor(
    reason: string,
    readonly agentText: string,
    readonly chatSessionId: string | null,
    detail: string,
  ) {
    super("BREAKING_CHANGE", reason, detail);
  }
}

/**
 * D6 at launch: throws a `LaunchError` (→ FAIL_LAUNCH with the plain reason)
 * when the change would break documents of the live version. When the check
 * can't run (or a live description can't be read) it fails closed while the
 * product drive holds documents or can't be read, and lets the launch go on
 * only when the drive is missing or empty; both are logged at error.
 */
async function compatGate(
  ctx: OrchestratorContext,
  number: number,
  liveTag: string,
  chatSessionId: string | null,
  state: StudioProductState,
): Promise<void> {
  const d = depsOf(ctx);
  let result: CompatResult | null = null;
  let problem: string;
  try {
    result = await (d.checkCompat ?? checkLaunchCompat)(ctx.workdir, liveTag);
    problem = result.unreadable.length ? `live descriptions not read: ${result.unreadable.join(", ")}` : "";
  } catch (err) {
    problem = message(err);
  }
  if (problem) await uncheckedGate(ctx, number, state, problem);
  const breaking = result?.breaking ?? [];
  if (breaking.length === 0) return;
  ctx.log?.warn?.(
    `[launch] Version ${number} stopped: ${breaking.map((b) => `${b.model}: ${b.what}`).join("; ")}`,
  );
  throw new BreakingChangeError(
    breakingReason(breaking),
    agentMessage(breaking),
    chatSessionId,
    `Version ${number} would break live documents.`,
  );
}

/** The check couldn't run: fail closed unless the product drive is missing or empty. */
async function uncheckedGate(
  ctx: OrchestratorContext,
  number: number,
  state: StudioProductState,
  problem: string,
): Promise<void> {
  const d = depsOf(ctx);
  const driveId = state.productDriveId;
  let documents = 0;
  if (driveId && state.slug) {
    try {
      documents = await (d.countDriveDocuments ?? countDriveDocuments)(ctx, liveSwitchboardUrl(state.slug), driveId);
    } catch (err) {
      ctx.log?.error?.(
        `[launch] Version ${number}: data compatibility not checked (${problem}) and the product drive couldn't be read: ${message(err)}`,
      );
      throw new LaunchError("COMPAT_UNCHECKED", COMPAT_UNCHECKED_REASON, problem);
    }
  }
  if (documents > 0) {
    ctx.log?.error?.(
      `[launch] Version ${number}: data compatibility not checked while the product drive holds ${documents} document(s): ${problem}`,
    );
    throw new LaunchError("COMPAT_UNCHECKED", COMPAT_UNCHECKED_REASON, problem);
  }
  ctx.log?.error?.(
    `[launch] Version ${number}: data compatibility not checked (no live documents, going on): ${problem}`,
  );
}

/** D6: tell the agent, in the change's conversation, to make the change additive. */
async function tellAgent(ctx: OrchestratorContext, number: number, err: BreakingChangeError): Promise<void> {
  if (!err.chatSessionId) {
    ctx.log?.warn?.(`[launch] Version ${number}: the change has no conversation to tell the agent in`);
    return;
  }
  try {
    await (depsOf(ctx).messageAgent ?? messageAgent)(ctx, err.chatSessionId, err.agentText, nowIso(ctx));
  } catch (sendErr) {
    ctx.log?.warn?.(`[launch] Version ${number}: the agent couldn't be told: ${message(sendErr)}`);
  }
}

/**
 * First launch, after DEPLOY is READY (F7b): create + seed the product drive,
 * record it on the App (which points the live Connect at it) and in the
 * product document. Examples the server refused are told in the story.
 */
async function openProductDrive(
  ctx: OrchestratorContext,
  state: StudioProductState,
  number: number,
  appId: string,
  slug: string,
): Promise<void> {
  const d = depsOf(ctx);
  const projects = await d.listProjects(ctx.workdir);
  const result = await d.ensureProductDrive(ctx, {
    appId,
    switchboardUrl: liveSwitchboardUrl(slug),
    name: state.name?.trim() || slug,
    appEditorId: appEditorId(ctx.workdir, projects),
    projectPath: projects.map((p) => path.join(ctx.workdir, p)),
  });
  await cloudCall(ctx, () => d.cloudSetProductDrive(ctx, appId, result.driveId));
  await dispatchProduct(ctx, [a.setProductDrive({ driveId: result.driveId, liveUrl: null })]);
  if (result.accessApplied === false) {
    ctx.log?.warn?.("[launch] who can use the product isn't set yet; tried again shortly");
  }
  const version = state.versions.find((v) => v.number === number);
  if (result.failedExamples.length > 0 && version?.changeId) {
    const n = result.failedExamples.length;
    try {
      await dispatchProduct(ctx, [
        a.addMilestone({
          changeId: version.changeId,
          id: `examples-not-added-${number}`,
          text: `${n === 1 ? "One example" : `${n} examples`} couldn't be added to your product: ${result.failedExamples.join(", ")}.`,
          at: nowIso(ctx),
        }),
      ]);
    } catch (err) {
      ctx.log?.warn?.(`[launch] examples line not added: ${message(err)}`);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Requests from the browser                                                 */
/* ------------------------------------------------------------------------ */

export type RequestOutcome =
  | { status: "DONE" }
  | { status: "REFUSED" | "FAILED"; reason: string };

/**
 * Record why a request couldn't be carried out and clear it (X28). The plain
 * reason is what the page shows (F39 style); a lost request would otherwise
 * leave the customer with nothing.
 */
export async function recordRequestFailure(
  ctx: OrchestratorContext,
  kind: RequestKind,
  reason: string,
): Promise<void> {
  try {
    await dispatchProduct(ctx, [a.failRequest({ kind, reason, at: nowIso(ctx) })]);
  } catch (err) {
    ctx.log?.error?.(`[launch] ${kind} failure not recorded: ${message(err)}`);
  }
}

/** Re-deploy a READY deployment and wait for it; returns the new deployment id. */
async function redeploy(ctx: OrchestratorContext, deploymentId: string): Promise<string> {
  const d = depsOf(ctx);
  const ref = await cloudCall(ctx, () => d.cloudRollback(ctx, deploymentId));
  const outcome = await cloudCall(ctx, () => d.waitForDeployment(ctx, ref.deploymentId));
  if (outcome !== "READY") {
    throw new LaunchError("ROLLBACK_FAILED", REASONS.rollbackStudioVersion, outcome.detail ?? outcome.failed);
  }
  return ref.deploymentId;
}

/** How often SET_LIVE_VERSION is tried after the cloud made Version m live. */
export const LIVE_VERSION_TRIES = 3;
/** Plain reason when Go back's deployment hadn't settled when the agent stopped waiting. */
export const ROLLBACK_SLOW_REASON = "the earlier version is still starting — it goes live as soon as it's up";

/**
 * Go back to Version m (spec §5.7, Ruling E5): the code goes back to `v<m>`
 * (refused while the Studio has unsaved changes — E6), the cloud re-deploys
 * Version m's deployment, and Version m becomes live. The request is cleared
 * either way.
 *
 * The code is put back on the live version only when the cloud definitely
 * failed (the re-deploy was refused, or its deployment FAILED). When the
 * wait gives up before the deployment settles, the code stays on m and the
 * live-health reconcile settles it from the cloud's record
 * (`awaitRollbackSettle`). A failed SET_LIVE_VERSION after READY is tried
 * again on its own; if it still fails, the reconcile records it.
 */
export async function rollbackTo(ctx: OrchestratorContext, m: number): Promise<RequestOutcome> {
  const d = depsOf(ctx);
  const state = (await getProductDoc(ctx))?.state;
  const target = state?.versions.find((v) => v.number === m);
  if (!state || !target?.deploymentId) {
    ctx.log?.error?.(`[launch] Go back to Version ${m}: no deployment recorded for it`);
    await recordRequestFailure(ctx, "ROLLBACK", REASONS.rollbackStudioVersion);
    return { status: "FAILED", reason: REASONS.rollbackStudioVersion };
  }
  const liveNumber = state.liveVersion ?? null;
  try {
    await d.restoreVersion(ctx.workdir, m);
  } catch (err) {
    const draftOpen = err instanceof LaunchError && err.code === "DRAFT_OPEN";
    const reason = draftOpen
      ? DRAFT_OPEN_REASON
      : err instanceof LaunchError
        ? err.reason
        : LAUNCH_REASONS.unexpected;
    ctx.log?.error?.(`[launch] Go back to Version ${m} refused: ${reason} (${message(err)})`);
    await recordRequestFailure(ctx, "ROLLBACK", reason);
    return { status: "REFUSED", reason };
  }

  /** The cloud definitely didn't make Version m live: the code goes back too. */
  const definitelyFailed = async (reason: string, why: string): Promise<RequestOutcome> => {
    ctx.log?.error?.(`[launch] Go back to Version ${m} failed: ${why}`);
    if (liveNumber !== null) {
      try {
        await d.restoreVersion(ctx.workdir, liveNumber);
      } catch (restoreErr) {
        ctx.log?.error?.(`[launch] code not put back on Version ${liveNumber}: ${message(restoreErr)}`);
      }
    }
    await recordRequestFailure(ctx, "ROLLBACK", reason);
    return { status: "FAILED", reason };
  };
  /** Not known yet: the code stays on m; the reconcile settles it. */
  const unsettled = async (why: string): Promise<RequestOutcome> => {
    ctx.log?.error?.(`[launch] Go back to Version ${m} not settled yet, the reconcile will settle it: ${why}`);
    awaitRollbackSettle({ number: m, previous: liveNumber });
    await recordRequestFailure(ctx, "ROLLBACK", ROLLBACK_SLOW_REASON);
    return { status: "FAILED", reason: ROLLBACK_SLOW_REASON };
  };

  let ref: { deploymentId: string };
  try {
    ref = await cloudCall(ctx, () => d.cloudRollback(ctx, target.deploymentId!));
  } catch (err) {
    // Only the cloud's refusal is definite; a lost answer may have started it.
    if (err instanceof LaunchError && err.code !== "CLOUD_UNAVAILABLE") {
      return definitelyFailed(err.reason, message(err));
    }
    return unsettled(message(err));
  }
  let outcome: Awaited<ReturnType<typeof d.waitForDeployment>>;
  try {
    outcome = await cloudCall(ctx, () => d.waitForDeployment(ctx, ref.deploymentId));
  } catch (err) {
    return unsettled(message(err));
  }
  if (outcome !== "READY") {
    if (outcome.timedOut) return unsettled(outcome.detail ?? outcome.failed);
    return definitelyFailed(REASONS.rollbackStudioVersion, outcome.detail ?? outcome.failed);
  }

  // READY: the cloud runs Version m. Record it, trying the write again on its own.
  for (let i = 1; ; i++) {
    try {
      await dispatchProduct(ctx, [
        a.setLiveVersion({ number: m, at: nowIso(ctx), deploymentId: ref.deploymentId }),
        a.clearRequest({}),
      ]);
      ctx.log?.info?.(`[launch] Version ${m} is live again`);
      return { status: "DONE" };
    } catch (err) {
      if (i < LIVE_VERSION_TRIES) {
        ctx.log?.warn?.(`[launch] Version ${m} is live; recording it failed (try ${i}): ${message(err)}`);
        await d.sleep(2_000 * i);
        continue;
      }
      ctx.log?.error?.(
        `[launch] Version ${m} is live but couldn't be recorded; the reconcile will record it: ${message(err)}`,
      );
      awaitRollbackSettle({ number: m, previous: liveNumber });
      // Never leave the request waiting (it would run again every pass).
      try {
        await dispatchProduct(ctx, [a.clearRequest({})]);
      } catch (clearErr) {
        ctx.log?.error?.(`[launch] Go back request not cleared: ${message(clearErr)}`);
      }
      return { status: "DONE" };
    }
  }
}

/**
 * Restart the live app (F15): re-deploy the live deployment
 * (`rollbackStudioVersion`); no git, no compatibility check.
 */
export async function restartLive(ctx: OrchestratorContext): Promise<RequestOutcome> {
  const state = (await getProductDoc(ctx))?.state;
  const live: Version | undefined = state?.versions.find((v) => v.number === state.liveVersion);
  const deploymentId = state?.liveDeploymentId ?? live?.deploymentId ?? null;
  if (!state || !live || !deploymentId) {
    ctx.log?.error?.("[launch] restart: nothing is live");
    await recordRequestFailure(ctx, "RESTART", REASONS.rollbackStudioVersion);
    return { status: "FAILED", reason: REASONS.rollbackStudioVersion };
  }
  try {
    const newId = await redeploy(ctx, deploymentId);
    await dispatchProduct(ctx, [
      a.setLiveVersion({ number: live.number, at: nowIso(ctx), deploymentId: newId }),
      a.clearRequest({}),
    ]);
    ctx.log?.info?.(`[launch] Version ${live.number} restarted`);
    return { status: "DONE" };
  } catch (err) {
    const reason = err instanceof LaunchError ? err.reason : LAUNCH_REASONS.unexpected;
    ctx.log?.error?.(`[launch] restart of Version ${live.number} failed: ${message(err)}`);
    await recordRequestFailure(ctx, "RESTART", reason);
    return { status: "FAILED", reason };
  }
}

/**
 * Throw the change away (customer-confirmed `DISCARD` request only): the
 * reactor projects go back to the live version's code and the change is
 * marked DISCARDED, so it can never go live by itself afterwards. With
 * nothing live yet there is no code to go back to and the files stay as they
 * are.
 */
export async function discardChange(ctx: OrchestratorContext, changeId: string | null): Promise<RequestOutcome> {
  if (!changeId) {
    ctx.log?.error?.("[launch] discard: no change named");
    await recordRequestFailure(ctx, "DISCARD", "no change was named");
    return { status: "FAILED", reason: "no change was named" };
  }
  const state = (await getProductDoc(ctx))?.state;
  const live = state?.versions.find((v) => v.number === state.liveVersion);
  try {
    if (live) {
      const unsaved = await depsOf(ctx).discardDraft(ctx.workdir, live.gitTag, { label: changeId });
      if (unsaved) ctx.log?.info?.(`[launch] the discarded code is kept at ${unsaved}`);
      ctx.log?.info?.(`[launch] change ${changeId} discarded; code back on Version ${live.number}`);
    } else {
      ctx.log?.info?.(`[launch] change ${changeId} discarded with nothing live; files kept`);
    }
    await dispatchProduct(ctx, [
      a.discardChange({ changeId, at: nowIso(ctx) }),
      a.clearRequest({}),
    ]);
    return { status: "DONE" };
  } catch (err) {
    const reason = err instanceof LaunchError ? err.reason : LAUNCH_REASONS.unexpected;
    ctx.log?.error?.(`[launch] discard of change ${changeId} failed: ${message(err)}`);
    await recordRequestFailure(ctx, "DISCARD", reason);
    return { status: "FAILED", reason };
  }
}

/**
 * Bring the product drive's protection in line with `state.access` (F35),
 * including the default access a first launch couldn't apply. `applied`
 * remembers, per drive, what this process applied when no local record exists.
 */
export async function syncAccess(
  ctx: OrchestratorContext,
  applied: Map<string, ProductAccess>,
): Promise<"in-sync" | "applied" | "skipped" | "failed"> {
  const state = (await getProductDoc(ctx))?.state;
  const driveId = state?.productDriveId;
  if (!state || !driveId) return "skipped";
  const desired = state.access;
  const record = readProductDriveRecord(ctx.workdir);
  const known = record?.driveId === driveId ? record : null;
  const switchboardUrl = known?.switchboardUrl ?? (state.slug ? liveSwitchboardUrl(state.slug) : null);
  if (!switchboardUrl) return "skipped";
  if (known?.adopted && !known.accessSet) {
    // Task 2.6: an adopted drive is never changed. Its protection was read,
    // not set, so the product document follows the drive first; only a later
    // customer change is pushed.
    if (!known.accessApplied || known.access === null) return "skipped";
    const observed = known.access;
    if (desired !== observed) {
      try {
        await dispatchProduct(ctx, [a.setAccess({ access: observed })]);
      } catch (err) {
        ctx.log?.warn?.(`[launch] product access not taken from the existing drive: ${message(err)}`);
        return "failed";
      }
      ctx.log?.info?.(`[launch] product access taken from the existing drive: ${observed}`);
    }
    try {
      markAccessAdopted(ctx, { switchboardUrl, driveId });
    } catch (err) {
      ctx.log?.warn?.(`[launch] adopted product access not recorded: ${message(err)}`);
    }
    applied.set(driveId, observed);
    return desired === observed ? "in-sync" : "applied";
  }
  if (known ? known.accessApplied && known.access === desired : applied.get(driveId) === desired) {
    return "in-sync";
  }
  try {
    await depsOf(ctx).setAccess(ctx, desired, { switchboardUrl, driveId });
    applied.set(driveId, desired);
    ctx.log?.info?.(`[launch] product access set to ${desired}`);
    return "applied";
  } catch (err) {
    ctx.log?.warn?.(`[launch] product access ${desired} not applied yet: ${message(err)}`);
    return "failed";
  }
}
