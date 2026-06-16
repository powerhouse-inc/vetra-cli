/**
 * Cloud (vetra.io) integration for the Deploy section. These point the Studio
 * at the same switchboard + drive vetra.to uses, so the environments shown here
 * are the user's real environments at staging.vetra.io. The Studio talks to
 * that switchboard directly (see cloudClient / cloudController): a dedicated
 * GraphQL client lists them, and a RemoteDocumentController applies signed
 * edits (Renown identity, no-`aud` token) that push to the remote.
 */

export const CLOUD_SWITCHBOARD_URL = "https://switchboard.staging.vetra.io";

/** Base domain for environments (`<subdomain>.vetra.io`). Fixed. */
export const CLOUD_BASE_DOMAIN = "vetra.io";

/** Default package registry stamped onto new environments (matches vetra.to). */
export const CLOUD_DEFAULT_PACKAGE_REGISTRY = "https://registry.dev.vetra.io";

/** vetra.to web app base — deep links to an environment's cloud page. */
export const VETRA_CLOUD_APP_URL = "https://staging.vetra.io";

/**
 * Drive that owns the environment documents (the `parentIdentifier` for
 * create/load). vetra.to staging currently serves the shared `powerhouse`
 * drive; the multi-drive migration moves ownership to per-user `user:<eth>`
 * drives. Switch CLOUD_DRIVE_SCOPE to "user" once staging serves user drives.
 */
export const CLOUD_DRIVE_SCOPE: "shared" | "user" = "shared";
const SHARED_DRIVE_ID = "powerhouse";

export function userDriveFor(address: string): string {
  return `user:${address.toLowerCase()}`;
}

/** The drive id that owns the signed-in user's environments. */
export function resolveCloudDriveId(address: string | undefined): string {
  if (CLOUD_DRIVE_SCOPE === "user" && address) return userDriveFor(address);
  return SHARED_DRIVE_ID;
}

export type CloudServiceType = "CONNECT" | "SWITCHBOARD" | "FUSION";

/** Services the user can toggle on an environment. CLINT is excluded — it needs
 * a package + env-var config beyond a simple toggle. */
export const MANAGEABLE_SERVICES: { type: CloudServiceType; prefix: string }[] =
  [
    { type: "CONNECT", prefix: "connect" },
    { type: "SWITCHBOARD", prefix: "switchboard" },
    { type: "FUSION", prefix: "fusion" },
  ];
