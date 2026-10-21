/**
 * Existing Studios open in the new experience (Task 3.7, spec §6.6): a real
 * in-memory reactor with an older Studio's drive (conversations, project
 * documents, no product), a real workspace with real git, and a fake cloud.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ReactorBuilder, ReactorClientBuilder, type ReactorClientModule } from "@powerhousedao/reactor";
import { addFile, driveDocumentModelModule, setDriveName } from "@powerhousedao/shared/document-drive";
import { ChatSession } from "@powerhousedao/clint-common/document-models/chat-session";
import { withSignaturePolicy } from "document-model";
import { StudioProductV1 } from "vetra-app/document-models";
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import { LaunchError } from "../../src/launch/errors.js";
import { ensureLiveTarget, type OrchestratorContext } from "../../src/launch/orchestrator.js";
import type { ProductTarget } from "../../src/launch/cloud-launch.js";
import {
  BEFORE_VERSIONS_REQUEST,
  UPGRADE_RECORD,
  adoptExisting,
  ensureProductTarget,
  environmentUrl,
  existingStudioUpgradeTrigger,
  readUpgradeRecord,
  refreshLiveBeforeVersions,
  runUpgrade,
  type LiveCandidate,
  type UpgradeContext,
} from "../../src/product/upgrade-existing.js";

const chat = ChatSession.actions;
const a = StudioProductV1.actions;
const NOW = "2026-10-21T12:00:00.000Z";
const PROD_SWITCHBOARD = "https://switchboard.vetra.io";
const OLD_ENV: LiveCandidate = { environmentId: "env-old", url: "https://bold-crow-connect.vetra.io" };

interface Harness {
  module: ReactorClientModule;
  driveId: string;
  workdir: string;
  ctx: UpgradeContext;
  logs: string[];
  liveCalls: string[][];
  live: LiveCandidate[] | Error;
  products(): Promise<string[]>;
  state(): Promise<StudioProductState>;
  session(messages: string[], createdAt?: string): Promise<string>;
  project(dir: string, opts?: { models?: boolean; editors?: boolean; registry?: string }): void;
  driveFile(id: string, documentType: string): Promise<void>;
}

let h: Harness;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

async function harness(): Promise<Harness> {
  const builder = new ReactorBuilder().withDocumentModelSources([
    driveDocumentModelModule as never,
    StudioProductV1 as never,
    ChatSession as never,
  ]);
  const module = await new ReactorClientBuilder()
    .withReactorBuilder(builder)
    .withCreateSignaturePolicy("legacy")
    .buildModule();
  const drive = await module.client.createEmpty("powerhouse/document-drive");
  const driveId = drive.header.id;
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-existing-"));
  const logs: string[] = [];
  const liveCalls: string[][] = [];
  const self: Harness = {
    module,
    driveId,
    workdir,
    logs,
    liveCalls,
    live: [],
    ctx: {
      folders: {},
      reactor: async () => ({ client: module.client, personalDriveId: driveId, driveId }),
      workdir,
      config: { cloudSwitchboardUrl: PROD_SWITCHBOARD, environmentId: "studio-env" },
      env: {},
      now: () => new Date(NOW),
      log: {
        info: (m) => logs.push(`info ${m}`),
        warn: (m) => logs.push(`warn ${m}`),
        error: (m) => logs.push(`error ${m}`),
      },
      upgradeDeps: {
        findLiveEnvironments: async (_ctx, names) => {
          liveCalls.push([...names]);
          if (self.live instanceof Error) throw self.live;
          return self.live;
        },
        newId: () => "before-versions",
      },
    },
    async products() {
      const d = (await module.client.get(driveId)) as {
        state: { global: { nodes: { id: string; documentType?: string }[] } };
      };
      return d.state.global.nodes.filter((n) => n.documentType === "vetra/studio-product").map((n) => n.id);
    },
    async state() {
      const [id] = await self.products();
      const d = (await module.client.get(id)) as { state: { global: StudioProductState } };
      return d.state.global;
    },
    async session(messages, createdAt) {
      const doc = withSignaturePolicy(ChatSession.utils.createDocument(), "legacy");
      if (createdAt) doc.header.createdAtUtcIso = createdAt;
      const id = (await module.client.createDocumentInDrive(driveId, doc)).header.id;
      if (messages.length > 0) {
        await module.client.execute(
          id,
          "main",
          messages.map((text, i) =>
            chat.addUserMessage({
              id: `${id}-m${i}`,
              content: [{ id: `${id}-p${i}`, type: "TEXT", text }],
              createdAt: NOW,
            }),
          ),
        );
      }
      return id;
    },
    project(dir, opts = {}) {
      const root = path.join(workdir, dir);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, "powerhouse.config.json"),
        JSON.stringify(opts.registry ? { packageRegistryUrl: opts.registry } : { studio: { port: 3000 } }, null, 2),
      );
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: `@vetra-apps/${dir}` }));
      if (opts.models !== false) fs.mkdirSync(path.join(root, "document-models", "todo"), { recursive: true });
      if (opts.editors) fs.mkdirSync(path.join(root, "editors", "todo-editor"), { recursive: true });
    },
    async driveFile(id, documentType) {
      await module.client.execute(driveId, "main", [
        addFile({ id, name: id, documentType, parentFolder: null }) as never,
      ]);
    },
  };
  return self;
}

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.module.reactor.kill().completed;
  fs.rmSync(h.workdir, { recursive: true, force: true });
});

describe("adoptExisting", () => {
  it("old Studio with two projects gets one product with both", async () => {
    h.project("todo-app", { editors: true });
    h.project("billing");
    await h.driveFile("model-todo", "powerhouse/document-model");
    await h.driveFile("model-billing", "powerhouse/document-model");
    await h.session(["build a todo app and billing"]);

    expect(await adoptExisting(h.ctx)).toBe("created");

    expect(await h.products()).toHaveLength(1);
    const s = await h.state();
    expect(s.changes).toHaveLength(1);
    const c = s.changes[0];
    expect(c).toMatchObject({ id: "before-versions", kind: "BEFORE_VERSIONS", status: "CLOSED", checkRuns: [] });
    expect(c.steps.map((st) => [st.kind, st.status])).toEqual([
      ["PLAN", "DONE"],
      ["DATA", "DONE"],
      ["EDITORS", "DONE"],
      ["TESTS", "NOT_STARTED"],
      ["LIVE", "NOT_STARTED"],
    ]);
    expect(s.activeChangeId).toBeNull();
    expect(s.liveVersion).toBeNull();
    // Both projects' packages are looked for on the owner's environments.
    expect(h.liveCalls).toEqual([["@vetra-apps/billing", "@vetra-apps/todo-app"]]);
    // Git: a repository on main, nothing committed or tagged until the first launch.
    expect(git(h.workdir, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
    expect(git(h.workdir, ["tag", "--list"])).toBe("");
    // R25: both projects publish to the stack's registry; nothing else in their config changed.
    for (const p of ["todo-app", "billing"]) {
      const config = JSON.parse(fs.readFileSync(path.join(h.workdir, p, "powerhouse.config.json"), "utf-8"));
      expect(config).toEqual({ studio: { port: 3000 }, packageRegistryUrl: "https://registry.vetra.io" });
    }
  });

  it("old chats become the Before versions chapter", async () => {
    await h.module.client.execute(h.driveId, "main", [setDriveName({ name: "Dog walks" }) as never]);
    const second = await h.session(["make the list sortable"], "2026-09-02T10:00:00.000Z");
    await h.session([], "2026-09-03T10:00:00.000Z");
    const first = await h.session(["a dog walking planner for my street"], "2026-09-01T10:00:00.000Z");

    expect(await adoptExisting(h.ctx)).toBe("created");

    const s = await h.state();
    expect(s.name).toBe("Dog walks");
    expect(s.idea).toBe("a dog walking planner for my street");
    const c = s.changes[0];
    expect(c.request).toBe(BEFORE_VERSIONS_REQUEST);
    // Oldest first; an empty conversation is not part of the story.
    expect(c.chatSessionIds).toEqual([first, second]);
    expect(c.chatSessionId).toBe(first);
    // No project yet: nothing is marked done.
    expect(c.steps.every((st) => st.status === "NOT_STARTED")).toBe(true);
    // The conversations themselves are untouched.
    const doc = (await h.module.client.get(first)) as { state: { global: { messages: unknown[] } } };
    expect(doc.state.global.messages).toHaveLength(1);
  });

  it("a previously deployed env shows as live before versions and is never modified", async () => {
    h.project("todo-app", { editors: true });
    await h.session(["build a todo app"]);
    h.live = [OLD_ENV];

    expect(await adoptExisting(h.ctx)).toBe("created");
    let s = await h.state();
    expect(s.liveBeforeVersions).toEqual({ environmentId: "env-old", url: OLD_ENV.url, at: NOW });
    // Not a version and not a live target yet.
    expect(s.versions).toEqual([]);
    expect(s.appId).toBeNull();
    expect(readUpgradeRecord(h.workdir)).toMatchObject({ live: "one", candidates: ["env-old"] });

    // Version 1 adopts it (F28): the cloud gets the env, nothing else touches it.
    const calls: { name: string; adopt?: string }[] = [];
    const target: ProductTarget = {
      appId: "app-1",
      productionEnvironmentId: "env-old",
      slug: "bold-crow",
      liveUrl: "https://bold-crow.vetra.io",
    };
    const ensure = async (name: string, opts?: { adoptEnvironmentId?: string }) => {
      calls.push({ name, adopt: opts?.adoptEnvironmentId });
      return target;
    };
    expect(await ensureProductTarget(h.ctx, s, "Todo app", ensure)).toEqual(target);
    expect(calls).toEqual([{ name: "Todo app", adopt: "env-old" }]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "adopted", environmentId: "env-old" });

    // Refused by the cloud: a new address (E10), the old env is left as it is.
    calls.length = 0;
    const refusing = async (name: string, opts?: { adoptEnvironmentId?: string }) => {
      calls.push({ name, adopt: opts?.adoptEnvironmentId });
      if (opts?.adoptEnvironmentId) throw new LaunchError("ADOPT_NOT_ALLOWED", "refused", "linked to an App");
      return { ...target, productionEnvironmentId: "env-new", slug: "todo-app" };
    };
    s = await h.state();
    const fallback = await ensureProductTarget(h.ctx, s, "Todo app", refusing);
    expect(fallback.productionEnvironmentId).toBe("env-new");
    expect(calls).toEqual([
      { name: "Todo app", adopt: "env-old" },
      { name: "Todo app", adopt: undefined },
    ]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "new", environmentId: "env-new" });

    // Any other refusal is not a fallback.
    const failing = async () => {
      throw new LaunchError("STUDIO_BINDING", "refused");
    };
    await expect(ensureProductTarget(h.ctx, s, "Todo app", failing)).rejects.toThrow("refused");
  });

  it("the launch's live target adopts the environment through ensureStudioProduct", async () => {
    h.project("todo-app");
    await h.session(["build a todo app"]);
    h.live = [OLD_ENV];
    await adoptExisting(h.ctx);
    const seen: (string | undefined)[] = [];
    const octx = {
      ...h.ctx,
      deps: {
        ensureProduct: async (_c: unknown, _name: string, opts?: { adoptEnvironmentId?: string }) => {
          seen.push(opts?.adoptEnvironmentId);
          return {
            appId: "app-1",
            productionEnvironmentId: "env-old",
            slug: "bold-crow",
            liveUrl: "https://bold-crow.vetra.io",
          };
        },
      },
    } as unknown as OrchestratorContext;
    const s = await ensureLiveTarget(octx);
    expect(seen).toEqual(["env-old"]);
    expect(s).toMatchObject({ appId: "app-1", productionEnvironmentId: "env-old", slug: "bold-crow" });
    // Shown as live before versions until Version 1 is live.
    expect(s.liveBeforeVersions?.environmentId).toBe("env-old");
  });

  it("several environments with the workspace: none is adopted, Version 1 gets a new address", async () => {
    h.project("todo-app");
    h.live = [OLD_ENV, { environmentId: "env-other", url: "https://calm-fox-connect.vetra.io" }];
    expect(await adoptExisting(h.ctx)).toBe("created");
    const s = await h.state();
    expect(s.liveBeforeVersions).toBeNull();
    expect(readUpgradeRecord(h.workdir)).toMatchObject({ live: "many", candidates: ["env-old", "env-other"] });
    const calls: (string | undefined)[] = [];
    await ensureProductTarget(h.ctx, s, "Todo app", async (_n, opts) => {
      calls.push(opts?.adoptEnvironmentId);
      return { appId: "a", productionEnvironmentId: "env-new", slug: "todo-app", liveUrl: "https://todo-app.vetra.io" };
    });
    expect(calls).toEqual([undefined]);
    expect(readUpgradeRecord(h.workdir).liveTarget).toMatchObject({ path: "new" });
  });

  it("second start does nothing", async () => {
    h.project("todo-app");
    await h.session(["build a todo app"]);
    expect(await adoptExisting(h.ctx)).toBe("created");
    const [id] = await h.products();
    const revision = (d: unknown) => JSON.stringify((d as { header: { revision: unknown } }).header.revision);
    const before = await h.module.client.get(id);
    const state = await h.state();

    expect(await adoptExisting(h.ctx)).toBe("skipped");
    expect(await h.products()).toEqual([id]);
    expect(revision(await h.module.client.get(id))).toBe(revision(before));
    expect(await h.state()).toEqual(state);
  });

  it("a new Studio, a Studio with a product and a one-shot run are left alone", async () => {
    // Nothing older: the idea screen stays.
    await h.session([]);
    expect(await adoptExisting(h.ctx)).toBe("skipped");
    expect(await h.products()).toEqual([]);
    // No running reactor.
    expect(await adoptExisting({ ...h.ctx, folders: undefined })).toBe("skipped");
    // A product made by the new page.
    await h.session(["old"]);
    const id = (
      await h.module.client.createDocumentInDrive(
        h.driveId,
        withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy"),
      )
    ).header.id;
    await h.module.client.execute(id, "main", [
      a.initProduct({ name: "New", idea: "new idea", createdAt: NOW }),
      a.startChange({ id: "c1", kind: "FIRST_BUILD", request: "new idea", startedAt: NOW }),
    ]);
    expect(await adoptExisting(h.ctx)).toBe("skipped");
    expect((await h.state()).changes.map((c) => c.kind)).toEqual(["FIRST_BUILD"]);
  });

  it("a failure leaves today's view and is logged; the next start completes it", async () => {
    h.project("todo-app");
    await h.session(["build a todo app"]);
    h.ctx.upgradeDeps = {
      ...h.ctx.upgradeDeps,
      ensureWorkspaceRepo: async () => {
        throw new Error("the code isn't on its main line");
      },
    };
    expect(await runUpgrade(h.ctx)).toBe("failed");
    expect(await h.products()).toEqual([]);
    expect(h.logs.some((l) => l.startsWith("error") && l.includes("keeps today's view"))).toBe(true);

    // A product document left without its operations (stopped half-way) is completed.
    const id = (
      await h.module.client.createDocumentInDrive(
        h.driveId,
        withSignaturePolicy(StudioProductV1.utils.createDocument(), "legacy"),
      )
    ).header.id;
    h.ctx.upgradeDeps = { ...h.ctx.upgradeDeps, ensureWorkspaceRepo: async () => {} };
    expect(await runUpgrade(h.ctx)).toBe("created");
    expect(await h.products()).toEqual([id]);
    expect((await h.state()).changes.map((c) => c.kind)).toEqual(["BEFORE_VERSIONS"]);
  });

  it("keeps a registry the Studio already names and never invents one off a known stack", async () => {
    h.project("named", { registry: "https://registry.example.org" });
    h.project("bare");
    await h.session(["x"]);
    await adoptExisting({ ...h.ctx, config: { ...h.ctx.config, cloudSwitchboardUrl: "https://switchboard.example.org" } });
    const read = (p: string) =>
      JSON.parse(fs.readFileSync(path.join(h.workdir, p, "powerhouse.config.json"), "utf-8")) as Record<string, unknown>;
    expect(read("named").packageRegistryUrl).toBe("https://registry.example.org");
    expect(read("bare").packageRegistryUrl).toBeUndefined();
    expect(h.logs.some((l) => l.startsWith("warn") && l.includes("no package registry"))).toBe(true);
    // PH_REGISTRY_URL set: nothing is written.
    const other = await harness();
    try {
      other.project("todo");
      await other.session(["x"]);
      await adoptExisting({ ...other.ctx, env: { PH_REGISTRY_URL: "https://registry.vetra.io" } });
      const config = JSON.parse(fs.readFileSync(path.join(other.workdir, "todo", "powerhouse.config.json"), "utf-8"));
      expect(config.packageRegistryUrl).toBeUndefined();
    } finally {
      await other.module.reactor.kill().completed;
      fs.rmSync(other.workdir, { recursive: true, force: true });
    }
  });

  it("a live check that couldn't run is tried again later, and the launch never guesses", async () => {
    h.project("todo-app");
    await h.session(["build a todo app"]);
    h.live = new Error("Not authorized");
    expect(await adoptExisting(h.ctx)).toBe("created");
    expect(readUpgradeRecord(h.workdir).live).toBe("pending");
    expect((await h.state()).liveBeforeVersions).toBeNull();

    // The launch can't tell which env to adopt yet: it stops instead of making a second address.
    const ensure = jest.fn(async () => ({ appId: "a", productionEnvironmentId: "e", slug: "s", liveUrl: "https://s.vetra.io" }));
    await expect(ensureProductTarget(h.ctx, await h.state(), "Todo app", ensure)).rejects.toMatchObject({
      code: "CLOUD_UNAVAILABLE",
    });
    expect(ensure).not.toHaveBeenCalled();

    // Signed in later: the retry finds the env and shows it.
    h.live = [OLD_ENV];
    expect(await refreshLiveBeforeVersions(h.ctx)).toBe("one");
    expect((await h.state()).liveBeforeVersions?.environmentId).toBe("env-old");
    expect(await refreshLiveBeforeVersions(h.ctx)).toBeNull();
  });

  it("the trigger runs the upgrade once, detached, and records it", async () => {
    h.project("todo-app");
    await h.session(["build a todo app"]);
    const state = existingStudioUpgradeTrigger.state!() as Record<string, unknown>;
    const tctx = { state, commandContext: h.ctx, context: { log: h.ctx.log } };
    const poll = existingStudioUpgradeTrigger.poll as (t: unknown) => Promise<unknown>;
    expect(await poll(tctx)).toBeNull();
    for (let i = 0; i < 100 && (await h.products()).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    for (let i = 0; i < 100 && state.running; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await h.products()).toHaveLength(1);
    expect(fs.existsSync(path.join(h.workdir, UPGRADE_RECORD))).toBe(true);
    // Later polls within the retry window do nothing.
    expect(await poll(tctx)).toBeNull();
    expect(state.running).toBe(false);
  });
});

describe("environmentUrl", () => {
  const base = {
    genericSubdomain: "bold-crow",
    genericBaseDomain: null,
    apexService: null,
    services: [{ type: "CONNECT", enabled: true, prefix: "connect" }],
  };
  it("is Connect's own host, or the apex when Connect is there", () => {
    expect(environmentUrl(base as never)).toBe("https://bold-crow-connect.vetra.io");
    expect(environmentUrl({ ...base, apexService: "CONNECT" } as never)).toBe("https://bold-crow.vetra.io");
    expect(environmentUrl({ ...base, services: [] } as never)).toBe("https://bold-crow.vetra.io");
    expect(environmentUrl({ ...base, genericSubdomain: null } as never)).toBeNull();
  });
});
