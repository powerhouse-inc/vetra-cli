import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyActionSignature } from "@powerhousedao/reactor";
import type { ISigner } from "document-model";
import { getRenown } from "../../src/auth/renown.js";
import { ensureTeamDoc, getTeamState, isOrgStudio, type TeamContext } from "../../src/team/team-doc.js";
import { productHarness, type ProductHarness } from "../product/helpers.js";

const USER = { address: "0x1111111111111111111111111111111111111111", networkId: "eip155", chainId: 1 };

describe("team document", () => {
  let h: ProductHarness;
  let workdir: string;
  beforeEach(async () => {
    h = await productHarness({ product: false });
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-team-"));
  });
  afterEach(async () => {
    await h.kill();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function ctx(config: TeamContext["config"], extra: Partial<TeamContext> = {}): TeamContext {
    return { ...h.ctx, folders: {}, workdir, config, now: () => new Date("2026-10-21T10:00:00.000Z"), ...extra } as TeamContext;
  }

  it("creates the team document once", async () => {
    const c = ctx({});
    const first = await ensureTeamDoc(c);
    expect(first.pending).toBe(false);
    expect(first.documentId).toEqual(expect.any(String));
    const second = await ensureTeamDoc(c);
    expect(second.documentId).toBe(first.documentId);
    const drive = (await h.module.client.get(h.driveId)) as { state: { global: { nodes: { documentType?: string }[] } } };
    expect(drive.state.global.nodes.filter((n) => n.documentType === "vetra/studio-team")).toHaveLength(1);
    const ops = await h.module.client.getOperations(first.documentId!, { branch: "main", scopes: ["global"] });
    expect(ops.results).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(workdir, ".ph/vetra/team/doc.json"), "utf-8"))).toEqual({ documentId: first.documentId });
  });

  it("org Studio starts with review required", async () => {
    const c = ctx({ studioOrgId: "org-acme" });
    expect(isOrgStudio(c.config)).toBe(true);
    await ensureTeamDoc(c);
    const s = await getTeamState(c);
    expect(s).toMatchObject({ initialized: true, orgId: "org-acme", reviewRequired: true });
  });

  it("personal Studio starts without review", async () => {
    const c = ctx({});
    expect(isOrgStudio(c.config)).toBe(false);
    await ensureTeamDoc(c);
    expect(await getTeamState(c)).toMatchObject({ initialized: true, orgId: null, reviewRequired: false });
  });

  it("cloud Studio without a signer waits and creates nothing", async () => {
    const c = ctx({ environmentId: "env-1" }, { teamDeps: { signer: async () => undefined } });
    expect(await ensureTeamDoc(c)).toEqual({ documentId: null, pending: true });
    const drive = (await h.module.client.get(h.driveId)) as { state: { global: { nodes: unknown[] } } };
    expect(drive.state.global.nodes).toHaveLength(0);
    expect(fs.existsSync(path.join(workdir, ".ph/vetra/team/doc.json"))).toBe(false);
  });

  it("cloud document is v2-required with a signed INIT_TEAM", async () => {
    const renown = await getRenown(workdir, "http://127.0.0.1:1");
    renown.signer.user = USER;
    const signer: ISigner = renown.signer;
    const c = ctx({ environmentId: "env-1", studioOrgId: "org-acme" }, { teamDeps: { signer: async () => signer } });
    const { documentId, pending } = await ensureTeamDoc(c);
    expect(pending).toBe(false);
    const ops = await h.module.client.getOperations(documentId!, { branch: "main", scopes: ["global"] });
    const op = ops.results[0] as unknown as {
      error?: string;
      action: { type: string; context?: { signer?: { user?: { address?: string }; signatures?: unknown[] } } };
    };
    expect(op.error).toBeUndefined();
    expect(op.action.type).toBe("INIT_TEAM");
    expect(op.action.context?.signer?.user?.address).toBe(USER.address);
    expect(op.action.context?.signer?.signatures).toHaveLength(1);
    const verdict = await verifyActionSignature(
      op.action as never,
      { documentId: documentId!, branch: "main", policy: "v2-required" },
      "mutation",
    );
    expect(verdict).toEqual({ ok: true, scheme: "v2" });
    expect((await getTeamState(c))?.reviewRequired).toBe(true);
  });
});
