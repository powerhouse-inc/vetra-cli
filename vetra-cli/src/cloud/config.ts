/**
 * Vetra Cloud (vetra.io) connection settings for the deploy commands.
 *
 * The agent talks to the same switchboard + Renown identity service the
 * vetra-app Studio Deploy section uses (vetra-app/editors/vetra-studio/deploy/
 * config.ts), so listing and editing environments here operate on the user's
 * real staging.vetra.io environments.
 */
import type { Config } from "../framework.js";

/** GraphQL switchboard that owns the environment documents. */
export const CLOUD_SWITCHBOARD_URL = "https://switchboard.staging.vetra.io";

/** Renown identity service: hosts the console login flow and issues the
 * verifiable credential the bearer token is built from. */
export const CLOUD_RENOWN_URL = "https://www.renown.id";

/** Base domain for environments (`<subdomain>.vetra.io`). */
export const CLOUD_BASE_DOMAIN = "vetra.io";

/** Default package registry stamped onto new environments (matches vetra.to). */
export const CLOUD_DEFAULT_PACKAGE_REGISTRY = "https://registry.dev.vetra.io";

/** Services the user can toggle on an environment, with their default host
 * prefix. CLINT is excluded — it needs a package + env-var config beyond a
 * simple toggle (mirrors vetra-app's MANAGEABLE_SERVICES). */
export type CloudServiceType = "CONNECT" | "SWITCHBOARD" | "FUSION";

export const SERVICE_PREFIXES: Record<CloudServiceType, string> = {
  CONNECT: "connect",
  SWITCHBOARD: "switchboard",
  FUSION: "fusion",
};

export function cloudGraphqlEndpoint(switchboardUrl: string): string {
  return `${switchboardUrl}/graphql`;
}

/**
 * Drive that owns the environment documents (the `parentIdentifier` for
 * create/load). staging serves the shared `powerhouse` drive today; the
 * multi-drive migration moves ownership to per-user `user:<eth>` drives.
 * Switch CLOUD_DRIVE_SCOPE to "user" once staging serves user drives.
 */
export const CLOUD_DRIVE_SCOPE: "shared" | "user" = "shared";
const SHARED_DRIVE_ID = "powerhouse";

/** The drive id that owns the signed-in user's environments. */
export function resolveCloudDriveId(address: string | undefined): string {
  if (CLOUD_DRIVE_SCOPE === "user" && address) return `user:${address.toLowerCase()}`;
  return SHARED_DRIVE_ID;
}

/** Resolve the cloud endpoints from config, defaulting to the constants above. */
export function resolveCloudConfig(
  config: Pick<Config, "cloudSwitchboardUrl" | "cloudRenownUrl">,
): { switchboardUrl: string; renownUrl: string; graphqlEndpoint: string } {
  const switchboardUrl = config.cloudSwitchboardUrl ?? CLOUD_SWITCHBOARD_URL;
  const renownUrl = config.cloudRenownUrl ?? CLOUD_RENOWN_URL;
  return { switchboardUrl, renownUrl, graphqlEndpoint: cloudGraphqlEndpoint(switchboardUrl) };
}
