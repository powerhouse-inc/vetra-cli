import type { CloudServiceType } from "./types.js";

/** GraphQL switchboard that owns the environment documents. */
export const CLOUD_SWITCHBOARD_URL = "https://switchboard.staging.vetra.io";

/** Renown identity service: hosts the console login flow and issues the
 * verifiable credential the bearer token is built from. */
export const CLOUD_RENOWN_URL = "https://www.renown.id";

/** Base domain for environments (`<subdomain>.vetra.io`). */
export const CLOUD_BASE_DOMAIN = "vetra.io";

/** Default package registry stamped onto new environments. */
export const CLOUD_DEFAULT_PACKAGE_REGISTRY = "https://registry.dev.vetra.io";

/** vetra.to web app base — deep links to an environment's cloud page. */
export const VETRA_CLOUD_APP_URL = "https://staging.vetra.io";

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
  if (CLOUD_DRIVE_SCOPE === "user" && address) {
    return `user:${address.toLowerCase()}`;
  }
  return SHARED_DRIVE_ID;
}

/** Default host slug per service — the per-service segment woven into the
 * environment host (`<subdomain>-<serviceSlug>.<base>`). Stored on the document
 * as the service's `prefix` field (vetra-cloud-package's schema name). */
export const SERVICE_SLUGS: Record<CloudServiceType, string> = {
  CONNECT: "connect",
  SWITCHBOARD: "switchboard",
  FUSION: "fusion",
};

/** Services the user can toggle, with their default slug (mirrors the order
 * the studio renders them). */
export const MANAGEABLE_SERVICES: { type: CloudServiceType; serviceSlug: string }[] = [
  { type: "CONNECT", serviceSlug: "connect" },
  { type: "SWITCHBOARD", serviceSlug: "switchboard" },
  { type: "FUSION", serviceSlug: "fusion" },
];
