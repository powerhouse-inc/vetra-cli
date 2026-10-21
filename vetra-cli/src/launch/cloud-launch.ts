/**
 * The Studio agent's calls into `vetra-apps` (designer's call D20): create
 * the product's App + production environment, launch a version, roll back.
 *
 * Every call carries the agent's Renown bearer (the owner's delegation to the
 * agent's did:key) and the Studio's launch secret in `x-vetra-studio-secret`
 * (Ruling E3; written into the Studio as `VETRA_STUDIO_LAUNCH_SECRET`). The
 * secret never reaches a log line or an error message.
 *
 * These are short requests: the cloud records the deployment and returns;
 * progress is read by polling (`waitForDeployment`, verify.ts). Nothing here
 * runs from the browser — the browser writes request operations into the
 * product document and the agent's trigger calls these (E7).
 */
import { CLOUD_BASE_DOMAIN } from "@powerhousedao/vetra-cloud-client";
import type { Config } from "../framework.js";
import { getBearerToken } from "../auth/renown.js";
import { resolveCloudConfig, resolveCloudGraphqlEndpoint } from "../cloud/config.js";
import { LaunchError } from "./errors.js";

export const STUDIO_SECRET_HEADER = "x-vetra-studio-secret";
export const STUDIO_SECRET_ENV = "VETRA_STUDIO_LAUNCH_SECRET";

/** Abort a single cloud request after this long (the ingress gives up at 30 s anyway). */
const REQUEST_TIMEOUT_MS = 60_000;

export interface CloudContext {
  workdir: string;
  config: Pick<Config, "cloudSwitchboardUrl" | "cloudRenownUrl" | "environmentId">;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  /** Seams for tests; default to global fetch, the agent's Renown bearer and process.env. */
  fetch?: typeof fetch;
  bearerToken?: () => Promise<string | null>;
  env?: Record<string, string | undefined>;
}

function studioSecret(ctx: CloudContext): string {
  const secret = (ctx.env ?? process.env)[STUDIO_SECRET_ENV]?.trim();
  if (!secret) {
    throw new LaunchError(
      "NO_LAUNCH_SECRET",
      "this Studio isn't set up to go live yet",
      `${STUDIO_SECRET_ENV} is not set in this Studio.`,
    );
  }
  return secret;
}

/** Replace every occurrence of the given secrets in `text`. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out;
}

interface GqlError {
  message?: string;
  extensions?: { code?: string };
}

/** One GraphQL call on the agent's Studio path; throws `LaunchError` with the cloud's code. */
export async function studioGql<T>(
  ctx: CloudContext,
  operation: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const secret = studioSecret(ctx);
  const endpoint = resolveCloudGraphqlEndpoint(ctx.config);
  const token = await (ctx.bearerToken
    ? ctx.bearerToken()
    : getBearerToken(ctx.workdir, resolveCloudConfig(ctx.config).renownUrl));
  if (!token) {
    throw new LaunchError(
      "PERMISSION",
      "your Studio needs your OK to publish",
      "The agent is not signed in with the owner's Renown identity.",
    );
  }
  const secrets = [secret, token];
  const doFetch = ctx.fetch ?? fetch;
  ctx.log?.debug?.(`[launch] ${operation} → ${endpoint}`);

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        [STUDIO_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err), secrets);
    ctx.log?.warn?.(`[launch] ${operation} failed: ${detail}`);
    throw new LaunchError("CLOUD_UNAVAILABLE", "Vetra didn't answer", `${operation}: ${detail}`);
  }

  let body: { data?: T; errors?: GqlError[] } | null = null;
  try {
    body = (await res.json()) as { data?: T; errors?: GqlError[] };
  } catch {
    body = null;
  }
  const first = body?.errors?.[0];
  if (first) {
    const code = first.extensions?.code ?? "CLOUD_ERROR";
    const detail = redact(first.message ?? "GraphQL error", secrets);
    ctx.log?.warn?.(`[launch] ${operation} refused (${code}): ${detail}`);
    const permission = code === "DELEGATION_EXPIRED" || code === "DELEGATION_MISSING";
    throw new LaunchError(
      code,
      permission ? "your Studio needs your OK to publish" : "the new version didn't start",
      `${operation}: ${detail}`,
    );
  }
  if (!res.ok || !body?.data) {
    ctx.log?.warn?.(`[launch] ${operation} failed: HTTP ${res.status}`);
    throw new LaunchError(
      "CLOUD_UNAVAILABLE",
      "Vetra didn't answer",
      `${operation}: HTTP ${res.status}`,
    );
  }
  return body.data;
}

export interface DeploymentRef {
  deploymentId: string;
  status: string;
}

export interface LaunchInput {
  appId: string;
  versionNumber: number;
  sha: string;
  gitTag: string;
  packages: { name: string; version: string }[];
}

/** Deploy Version n of the product (`launchStudioVersion`, trigger STUDIO_LAUNCH). */
export async function cloudLaunch(ctx: CloudContext, input: LaunchInput): Promise<DeploymentRef> {
  const data = await studioGql<{ launchStudioVersion: { id: string; status: string } }>(
    ctx,
    "launchStudioVersion",
    `mutation LaunchStudioVersion($input: LaunchStudioVersionInput!) {
      launchStudioVersion(input: $input) { id status }
    }`,
    { input },
  );
  return { deploymentId: data.launchStudioVersion.id, status: data.launchStudioVersion.status };
}

/** Re-deploy a READY production deployment of the product (`rollbackStudioVersion`). */
export async function cloudRollback(ctx: CloudContext, deploymentId: string): Promise<DeploymentRef> {
  const data = await studioGql<{ rollbackStudioVersion: { id: string; status: string } }>(
    ctx,
    "rollbackStudioVersion",
    `mutation RollbackStudioVersion($deploymentId: ID!) {
      rollbackStudioVersion(deploymentId: $deploymentId) { id status }
    }`,
    { deploymentId },
  );
  return { deploymentId: data.rollbackStudioVersion.id, status: data.rollbackStudioVersion.status };
}

export interface ProductTarget {
  appId: string;
  productionEnvironmentId: string;
  slug: string;
  /** `https://<slug>.vetra.io` (Connect at the apex). */
  liveUrl: string;
}

interface AppPayload {
  id: string;
  slug: string;
  productionEnvironmentId: string;
  productionUrls?: { connect?: string | null } | null;
}

/**
 * The product's App + production environment, created on first call and
 * returned as-is afterwards (`ensureStudioProduct` is idempotent per Studio).
 * The result feeds `SET_LIVE_TARGET`.
 */
export async function ensureProduct(ctx: CloudContext, name: string): Promise<ProductTarget> {
  const studioEnvironmentId = ctx.config.environmentId?.trim();
  if (!studioEnvironmentId) {
    throw new LaunchError(
      "NO_STUDIO",
      "this Studio isn't set up to go live yet",
      "No studio environment id (VETRA_ENVIRONMENT_ID) configured.",
    );
  }
  const data = await studioGql<{ ensureStudioProduct: AppPayload }>(
    ctx,
    "ensureStudioProduct",
    `mutation EnsureStudioProduct($input: EnsureStudioProductInput!) {
      ensureStudioProduct(input: $input) {
        id slug productionEnvironmentId productionUrls { connect }
      }
    }`,
    { input: { studioEnvironmentId, name } },
  );
  const app = data.ensureStudioProduct;
  const connect = app.productionUrls?.connect ?? null;
  const host = connect ? new URL(connect).hostname : null;
  const slug = host && host.endsWith(`.${CLOUD_BASE_DOMAIN}`) ? host.split(".")[0] : app.slug;
  return {
    appId: app.id,
    productionEnvironmentId: app.productionEnvironmentId,
    slug,
    liveUrl: connect ?? `https://${app.slug}.${CLOUD_BASE_DOMAIN}`,
  };
}
