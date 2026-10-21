import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StudioProductV1 } from "vetra-app/document-models";
import type { StepKind } from "vetra-app/document-models/studio-product";
import type { LaunchDeps, OrchestratorContext } from "../../src/launch/orchestrator.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { productHarness, type ProductHarness } from "../product/helpers.js";

export const a = StudioProductV1.actions;
export const AT = "2026-10-21T09:00:00.000Z";

export const TARGET = {
  appId: "app-1",
  productionEnvironmentId: "env-prod-1",
  slug: "team-todo",
  liveUrl: "https://team-todo.vetra.io",
};

export interface LaunchHarness extends ProductHarness {
  octx: OrchestratorContext;
  calls: string[];
  lines: string[];
  sleeps: number[];
  deps: LaunchDeps;
  workdir: string;
  cleanup(): Promise<void>;
}

/** A product harness plus a launch context whose every outside call is a recorded fake. */
export async function launchHarness(
  over: Partial<LaunchDeps> = {},
  opts: { changeId?: string; kind?: "FIRST_BUILD" | "CHANGE" | "UNDO" } = {},
): Promise<LaunchHarness> {
  const h = await productHarness({ name: "Team Todo", changeId: opts.changeId, kind: opts.kind });
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-"));
  const calls: string[] = [];
  const lines: string[] = [];
  const sleeps: number[] = [];
  const deps: LaunchDeps = {
    ensureProduct: async (_ctx, name) => {
      calls.push(`ensureProduct ${name}`);
      return TARGET;
    },
    snapshot: async (_wd, n, title, o) => {
      calls.push(`snapshot ${n} "${title}" retag=${String(o?.allowRetag ?? false)}`);
      return { sha: `sha-${n}`, tag: `v${n}` };
    },
    publishAll: async (_ctx, _wd, o) => {
      calls.push(`publish ${o.slug} live=${o.live?.tag ?? "none"}`);
      return [{ name: "@vetra-apps/team-todo", version: `1.0.${calls.length}` }];
    },
    cloudLaunch: async (_ctx, input) => {
      calls.push(`launch ${input.versionNumber} ${input.sha} ${input.gitTag}`);
      return { deploymentId: `dep-${input.versionNumber}`, status: "PENDING" };
    },
    waitForDeployment: async (_ctx, id) => {
      calls.push(`wait ${id}`);
      return "READY";
    },
    checkLive: async (url) => {
      calls.push(`check ${url}`);
      return true;
    },
    ensureProductDrive: async (_ctx, o) => {
      calls.push(`drive ${o.appId} ${o.switchboardUrl} "${o.name}"`);
      return { driveId: "drive-1", accessApplied: true, access: "SIGNED_IN", failedExamples: [] };
    },
    cloudSetProductDrive: async (_ctx, appId, driveId) => {
      calls.push(`setDrive ${appId} ${driveId}`);
    },
    cloudRollback: async (_ctx, id) => {
      calls.push(`rollback ${id}`);
      return { deploymentId: `${id}-again`, status: "PENDING" };
    },
    restoreVersion: async (_wd, m) => {
      calls.push(`restore ${m}`);
      return { sha: `restored-${m}` };
    },
    discardDraft: async (_wd, tag) => {
      calls.push(`discard ${tag}`);
      return null;
    },
    setAccess: async (_ctx, access, target) => {
      calls.push(`access ${access} ${target.driveId}`);
    },
    changedFiles: () => ["todo-app/document-models/todo/schema.graphql"],
    listProjects: async () => ["todo-app"],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...over,
  };
  const log = (msg: string) => {
    lines.push(msg);
  };
  const octx: OrchestratorContext = {
    ...h.ctx,
    workdir,
    config: { cloudSwitchboardUrl: "https://cloud.example.test", environmentId: "studio-env-1" },
    log: { info: log, warn: log, error: log, debug: log },
    deps,
    now: () => new Date(AT),
  };
  return {
    ...h,
    octx,
    calls,
    lines,
    sleeps,
    deps,
    workdir,
    async cleanup() {
      await h.kill();
      await fs.rm(workdir, { recursive: true, force: true });
    },
  };
}

/** Plan `steps` (+ LIVE) on the change and finish every one but LIVE: the change is READY. */
export async function makeReady(
  h: ProductHarness,
  changeId = "change-1",
  opts: { title?: string; steps?: StepKind[] } = {},
): Promise<void> {
  const steps = opts.steps ?? ["PLAN"];
  await dispatchProduct(h.ctx, [
    ...(opts.title ? [a.setChangeTitle({ changeId, title: opts.title })] : []),
    a.planSteps({ changeId, steps: [...steps, "LIVE" as const].map((kind) => ({ kind, total: null })) }),
    ...steps.map((kind) => a.completeStep({ changeId, kind, at: AT })),
  ]);
}

/** Start a new change of `kind` and make it READY. */
export async function readyChange(
  h: ProductHarness,
  changeId: string,
  kind: "CHANGE" | "UNDO" = "CHANGE",
): Promise<void> {
  await dispatchProduct(h.ctx, [
    a.startChange({ id: changeId, kind, request: `request for ${changeId}`, startedAt: AT }),
  ]);
  await makeReady(h, changeId);
}
