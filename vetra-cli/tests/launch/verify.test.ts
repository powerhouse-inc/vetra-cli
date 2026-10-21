import { describe, expect, it, jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { STUDIO_SECRET_ENV, type CloudContext } from "../../src/launch/cloud-launch.js";
import { checkLive, DEPLOY_FAILED_REASON, waitForDeployment } from "../../src/launch/verify.js";

function cloud(responses: Array<{ status?: number; json: unknown } | Error>) {
  let i = 0;
  const fetchFn = jest.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  });
  const ctx: CloudContext = {
    workdir: "/nowhere",
    config: { cloudSwitchboardUrl: "https://switchboard.example.test" },
    fetch: fetchFn,
    bearerToken: async () => "bearer",
    env: { [STUDIO_SECRET_ENV]: randomBytes(32).toString("hex") },
  };
  return { ctx, fetchFn };
}

const dep = (status: string, error: string | null = null) => ({
  json: { data: { appDeployment: { id: "dep-1", status, error } } },
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("waitForDeployment", () => {
  it("polls until READY and tolerates a blip", async () => {
    const { ctx, fetchFn } = cloud([
      dep("PENDING"),
      new Error("ECONNRESET"),
      { status: 502, json: {} },
      dep("DEPLOYING"),
      dep("READY"),
    ]);
    expect(await waitForDeployment(ctx, "dep-1", { ...clock() })).toBe("READY");
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("returns the plain reason when the deployment failed", async () => {
    const { ctx } = cloud([dep("DEPLOYING"), dep("FAILED", "ImagePullBackOff")]);
    expect(await waitForDeployment(ctx, "dep-1", { ...clock() })).toEqual({
      failed: DEPLOY_FAILED_REASON,
      detail: "ImagePullBackOff",
    });
  });

  it("gives up after the timeout", async () => {
    const { ctx } = cloud([dep("DEPLOYING")]);
    const out = await waitForDeployment(ctx, "dep-1", { timeoutMs: 60_000, intervalMs: 5_000, ...clock() });
    expect(out).toMatchObject({ failed: DEPLOY_FAILED_REASON });
  });

  it("stops at once when the cloud refuses the agent", async () => {
    const { ctx, fetchFn } = cloud([
      { json: { errors: [{ message: "x", extensions: { code: "DELEGATION_EXPIRED" } }] } },
    ]);
    await expect(waitForDeployment(ctx, "dep-1", { ...clock() })).rejects.toMatchObject({
      code: "DELEGATION_EXPIRED",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("checkLive", () => {
  it("is true on HTTP 200, retrying up to 3 times 10 s apart", async () => {
    const sleeps: number[] = [];
    const fetchFn = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ENOTFOUND"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const ok = await checkLive("https://team-todo.vetra.io", {
      fetch: fetchFn,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(ok).toBe(true);
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("is false when the address never answers 200", async () => {
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 502 }));
    expect(await checkLive("https://x.vetra.io", { fetch: fetchFn, sleep: async () => {} })).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
