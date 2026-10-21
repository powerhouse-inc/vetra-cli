import { describe, expect, it } from "@jest/globals";
import { LaunchError } from "../../src/launch/errors.js";
import type { CloudContext, PushToken } from "../../src/launch/cloud-launch.js";
import { legacyPushToken, productPushToken } from "../../src/helpers/github.js";

const STUDIO_ENV = "studio-env-1";
const BEARER = "bearer-abc123";
const PRODUCT_TOKEN: PushToken = {
  token: "ghs_product_token",
  expiresAt: "2026-10-21T10:00:00.000Z",
  remoteUrl: "https://github.com/acme/team-todo.git",
};

interface Seen {
  query: string;
  variables: Record<string, unknown>;
  authorization: string | null;
}

/** A cloud whose vetra-github-auth answers with `answer(query)` (GraphQL body or a thrown error). */
function cloud(answer: (query: string) => unknown) {
  const seen: Seen[] = [];
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  const ctx: CloudContext = {
    workdir: "/tmp/does-not-matter",
    config: { environmentId: STUDIO_ENV, cloudSwitchboardUrl: "https://switchboard.test" },
    log: { info: log, warn: log, error: log, debug: log },
    bearerToken: async () => BEARER,
    fetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      const headers = init.headers as Record<string, string>;
      seen.push({ query: body.query, variables: body.variables, authorization: headers.authorization ?? null });
      const out = await answer(body.query);
      return out instanceof Response ? out : Response.json(out);
    }) as typeof fetch,
  };
  return { ctx, seen, lines };
}

const connected = (repoFullName: string) => ({
  data: {
    VetraGithubAuth: {
      myGithubConnection: { connected: true, connection: { repoFullName } },
    },
  },
});
const legacyToken = (token: string) => ({
  data: { VetraGithubAuth: { getPushToken: { token, expiresAt: "2026-10-21T11:00:00.000Z" } } },
});
const gqlError = (code: string, message = code) => ({ data: null, errors: [{ message, extensions: { code } }] });

const notConnected = (cloudReason?: string) => {
  const err = new LaunchError("GITHUB_NOT_CONNECTED", "GitHub didn't let Vetra in", "studioPushToken: no repository");
  err.cloudReason = cloudReason;
  return err;
};

describe("push token selector", () => {
  it("pushes with the product's GitHub connection when the product has a repository", async () => {
    const c = cloud(() => {
      throw new Error("vetra-github-auth must not be asked");
    });
    const token = await productPushToken(c.ctx, "app-1", {
      studio: async (_ctx, appId) => {
        expect(appId).toBe("app-1");
        return PRODUCT_TOKEN;
      },
    });
    expect(token).toEqual(PRODUCT_TOKEN);
    expect(c.seen).toHaveLength(0);
  });

  it("existing connection keeps pushing until moved", async () => {
    const c = cloud((query) =>
      query.includes("myGithubConnection") ? connected("frank/my-shop-studio") : legacyToken("ghs_legacy_token"),
    );
    const token = await productPushToken(c.ctx, "app-1", {
      studio: async () => Promise.reject(notConnected("NEVER_CONNECTED")),
    });
    expect(token).toEqual({
      token: "ghs_legacy_token",
      expiresAt: "2026-10-21T11:00:00.000Z",
      remoteUrl: "https://github.com/frank/my-shop-studio.git",
    });
    expect(c.seen.map((s) => s.variables)).toEqual([{ environmentId: STUDIO_ENV }, { environmentId: STUDIO_ENV }]);
    expect(c.seen.every((s) => s.authorization === `Bearer ${BEARER}`)).toBe(true);
    expect(c.lines.join("\n")).not.toContain("ghs_legacy_token");
  });

  it("only a product that never had a repository falls back", async () => {
    const c = cloud((query) =>
      query.includes("myGithubConnection") ? connected("frank/shop") : legacyToken("ghs_legacy_token"),
    );
    for (const why of ["DISCONNECTED", "TOKEN_REFUSED"]) {
      const err = notConnected(why);
      let asked = 0;
      await expect(
        productPushToken(c.ctx, "app-1", {
          studio: async () => Promise.reject(err),
          legacy: async () => {
            asked++;
            return PRODUCT_TOKEN;
          },
        }),
      ).rejects.toBe(err);
      expect(asked).toBe(0);
    }
  });

  it("a cloud that doesn't say why falls back only when the product has no repository", async () => {
    const product = (repository: unknown) => (query: string) =>
      query.includes("studioProduct")
        ? { data: { studioProduct: { id: "app-1", repository } } }
        : query.includes("myGithubConnection")
          ? connected("frank/shop")
          : legacyToken("ghs_legacy_token");
    const unsupported = new LaunchError("GRAPHQL_VALIDATION_FAILED", "GitHub didn't let Vetra in", "Cannot query field");
    for (const err of [notConnected(), unsupported]) {
      const none = cloud(product(null));
      const token = await productPushToken(none.ctx, "app-1", { studio: async () => Promise.reject(err) });
      expect(token.remoteUrl).toBe("https://github.com/frank/shop.git");
      expect(none.seen[0].variables).toEqual({ studioEnvironmentId: STUDIO_ENV });

      const had = cloud(product({ fullName: "acme/shop", disconnectedAt: "2026-10-03T00:00:00.000Z" }));
      await expect(productPushToken(had.ctx, "app-1", { studio: async () => Promise.reject(err) })).rejects.toBe(err);
      expect(had.seen).toHaveLength(1);

      const unknown = cloud(() => new Response("down", { status: 503 }));
      await expect(productPushToken(unknown.ctx, "app-1", { studio: async () => Promise.reject(err) })).rejects.toBe(
        err,
      );
    }
  });

  it("a Studio with neither connection is not connected", async () => {
    const c = cloud(() => ({
      data: { VetraGithubAuth: { myGithubConnection: { connected: false, connection: null } } },
    }));
    const err = notConnected("NEVER_CONNECTED");
    await expect(productPushToken(c.ctx, "app-1", { studio: async () => Promise.reject(err) })).rejects.toBe(err);
    // Only asked whether there is a connection.
    expect(c.seen).toHaveLength(1);
  });

  it("other refusals of the product's token are not hidden by the old connection", async () => {
    const c = cloud(() => connected("frank/shop"));
    for (const code of ["CLOUD_UNAVAILABLE", "STUDIO_BINDING", "INSUFFICIENT_PERMISSION", "BAD_USER_INPUT"]) {
      const err = new LaunchError(code, "GitHub didn't let Vetra in");
      await expect(productPushToken(c.ctx, "app-1", { studio: async () => Promise.reject(err) })).rejects.toBe(err);
    }
    expect(c.seen).toHaveLength(0);
  });
});

describe("the Studio's earlier GitHub connection", () => {
  it("is none when the old app isn't installed on the repository any more", async () => {
    for (const code of ["NOT_CONNECTED", "APP_NOT_INSTALLED", "REINSTALL_REQUIRED"]) {
      const c = cloud((query) => (query.includes("myGithubConnection") ? connected("frank/shop") : gqlError(code)));
      expect(await legacyPushToken(c.ctx)).toBeNull();
    }
  });

  it("is none on a cloud without it, without a Studio id or without a sign-in", async () => {
    const c = cloud(() => gqlError("GRAPHQL_VALIDATION_FAILED", 'Cannot query field "VetraGithubAuth" on type "Query".'));
    expect(await legacyPushToken(c.ctx)).toBeNull();

    const noEnv = cloud(() => connected("frank/shop"));
    noEnv.ctx.config = { ...noEnv.ctx.config, environmentId: "  " };
    expect(await legacyPushToken(noEnv.ctx)).toBeNull();
    expect(noEnv.seen).toHaveLength(0);

    const noBearer = cloud(() => connected("frank/shop"));
    noBearer.ctx.bearerToken = async () => null;
    expect(await legacyPushToken(noBearer.ctx)).toBeNull();
    expect(noBearer.seen).toHaveLength(0);
  });

  it("an odd repository name is not pushed to", async () => {
    const c = cloud((query) =>
      query.includes("myGithubConnection") ? connected("frank/shop/../../x") : legacyToken("ghs_legacy_token"),
    );
    expect(await legacyPushToken(c.ctx)).toBeNull();
  });

  it("a cloud that doesn't answer is told in plain words, without the token or sign-in", async () => {
    const c = cloud(() => {
      throw new TypeError(`connect ECONNREFUSED (Bearer ${BEARER})`);
    });
    const err = await legacyPushToken(c.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("CLOUD_UNAVAILABLE");
    expect((err as LaunchError).reason).toBe("Vetra didn't answer");
    expect((err as LaunchError).message).not.toContain(BEARER);

    const bad = cloud((query) =>
      query.includes("myGithubConnection")
        ? connected("frank/shop")
        : new Response("upstream ghs_leaky_token", { status: 502 }),
    );
    const err2 = await legacyPushToken(bad.ctx).catch((e: unknown) => e);
    expect((err2 as LaunchError).code).toBe("CLOUD_UNAVAILABLE");
    expect((err2 as LaunchError).message).not.toContain("ghs_leaky_token");

    const refused = cloud((query) =>
      query.includes("myGithubConnection") ? connected("frank/shop") : gqlError("INTERNAL_SERVER_ERROR", "boom"),
    );
    const err3 = await legacyPushToken(refused.ctx).catch((e: unknown) => e);
    expect((err3 as LaunchError).reason).toBe("GitHub didn't let Vetra in");
  });
});
