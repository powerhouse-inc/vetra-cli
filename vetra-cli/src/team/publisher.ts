/**
 * Who publishes a Studio's packages (P6-5, task 1.11). A personal Studio
 * publishes as its owner, as before. An org Studio publishes as the
 * organisation's publisher: package ownership must not depend on a person, so
 * the cloud creates one publisher EOA per org and delegates it to this
 * Studio's agent key (`orgPublisherCredential`). The delegation is fetched
 * once, cached in the workdir (0600), and refreshed three days before it
 * expires.
 */
import fs from "node:fs";
import path from "node:path";

import { getRegistryToken, getRenown } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import type { Config } from "../framework.js";
import { LaunchError } from "../launch/errors.js";
import { studioGql, type CloudContext } from "../launch/cloud-launch.js";

/** The cached org-publisher delegation, in the Studio's trust boundary. */
export const PUBLISHER_FILE = path.join(".ph", "vetra", "team", "publisher.json");
/** A delegation with less than this left is replaced instead of used. */
export const PUBLISHER_REFRESH_MS = 3 * 24 * 60 * 60 * 1000;

export type PublishIdentity = { kind: "owner" } | { kind: "org"; address: string };

export interface StoredPublisherCredential {
  address: string;
  /** The signed Renown delegation (JSON), as the cloud returned it. */
  credential: string;
  expiresAt: string;
}

export interface PublisherContext extends CloudContext {
  /** The Studio's organisation and its Renown org read (org Studio only). */
  config: CloudContext["config"] & Pick<Config, "studioOrgId" | "renownOrgsUrl">;
  now?: () => number;
}

/** Seams for tests: the cloud call and where registry tokens come from. */
export interface PublisherDeps {
  fetchCredential(ctx: PublisherContext, environmentId: string): Promise<StoredPublisherCredential>;
  /** A registry token for `address` (null: the owner's own identity). */
  registryToken(
    ctx: PublisherContext,
    address: string | null,
    registryUrl: string,
  ): Promise<string | null>;
}

const CREDENTIAL_MUTATION = `mutation OrgPublisherCredential($environmentId: String!) {
  VetraStudioPool { orgPublisherCredential(environmentId: $environmentId) { address credential expiresAt } }
}`;

interface CredentialResult {
  VetraStudioPool?: {
    orgPublisherCredential?: { address?: unknown; credential?: unknown; expiresAt?: unknown } | null;
  } | null;
}

async function fetchOrgPublisherCredential(
  ctx: PublisherContext,
  environmentId: string,
): Promise<StoredPublisherCredential> {
  const data = await studioGql<CredentialResult>(ctx, "orgPublisherCredential", CREDENTIAL_MUTATION, {
    environmentId,
  });
  const result = data.VetraStudioPool?.orgPublisherCredential;
  if (
    !result ||
    typeof result.address !== "string" ||
    typeof result.credential !== "string" ||
    typeof result.expiresAt !== "string"
  ) {
    throw new LaunchError(
      "PUBLISH_FAILED",
      "publishing didn't finish",
      "The organisation's publisher delegation came back empty.",
    );
  }
  return { address: result.address, credential: result.credential, expiresAt: result.expiresAt };
}

/** Mint a registry-bound bearer as the organisation's publisher. */
async function publisherRegistryToken(
  ctx: PublisherContext,
  address: string | null,
  registryUrl: string,
): Promise<string | null> {
  if (!address) return null;
  const renown = await getRenown(ctx.workdir, resolveCloudConfig(ctx.config).renownUrl);
  return renown.crypto.getBearerToken(address, { expiresIn: 300, aud: registryUrl });
}

const defaultDeps: PublisherDeps = {
  fetchCredential: fetchOrgPublisherCredential,
  registryToken: publisherRegistryToken,
};

function readCache(workdir: string): StoredPublisherCredential | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(workdir, PUBLISHER_FILE), "utf-8")) as
      | Partial<StoredPublisherCredential>
      | null;
    if (
      !parsed ||
      typeof parsed.address !== "string" ||
      typeof parsed.credential !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return { address: parsed.address, credential: parsed.credential, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeCache(workdir: string, stored: StoredPublisherCredential): void {
  const file = path.join(workdir, PUBLISHER_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...stored }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * The identity this Studio publishes as: the owner (personal Studio), or the
 * organisation's publisher (org Studio; the delegation is fetched when missing
 * or close to expiring). A missing delegation is a launch failure, never a
 * silent fallback to a person's identity.
 */
export async function publishIdentity(
  ctx: PublisherContext,
  deps: PublisherDeps = defaultDeps,
): Promise<PublishIdentity> {
  const orgId = ctx.config.studioOrgId?.trim();
  if (!orgId) return { kind: "owner" };
  const environmentId = ctx.config.environmentId?.trim();
  if (!environmentId) {
    throw new LaunchError(
      "PUBLISH_FAILED",
      "publishing didn't finish",
      "An organisation Studio publishes as its organisation, but it has no environment id.",
    );
  }
  const now = (ctx.now ?? Date.now)();
  const cached = readCache(ctx.workdir);
  if (
    cached &&
    Number.isFinite(Date.parse(cached.expiresAt)) &&
    Date.parse(cached.expiresAt) - now > PUBLISHER_REFRESH_MS
  ) {
    return { kind: "org", address: cached.address };
  }
  const fetched = await deps.fetchCredential(ctx, environmentId);
  writeCache(ctx.workdir, fetched);
  ctx.log?.info?.(`[publish] publishing as the organisation's publisher ${fetched.address}`);
  return { kind: "org", address: fetched.address };
}

/** The registry token for `identity`: the owner's own, or the org publisher's. */
export async function registryTokenFor(
  ctx: PublisherContext,
  identity: PublishIdentity,
  registryUrl: string,
  deps: PublisherDeps = defaultDeps,
): Promise<string | null> {
  if (identity.kind === "org") return deps.registryToken(ctx, identity.address, registryUrl);
  return getRegistryToken(ctx.workdir, resolveCloudConfig(ctx.config).renownUrl, registryUrl);
}
