/**
 * The cloud Studio's owner rule, apart from `renown.ts` so a command can apply
 * it without loading Renown (the start path stays light).
 */

let requireAdminOverride: boolean | undefined;

/** Whether the agent's identity must be an ADMINS wallet: in a cloud Studio
 * (VETRA_ENVIRONMENT_ID / `config.environmentId`), unless set explicitly. */
export function requireAdminIdentity(): boolean {
  return requireAdminOverride ?? Boolean(process.env.VETRA_ENVIRONMENT_ID?.trim());
}

/** Set by the daemon from `config.environmentId` (undefined: env fallback). */
export function setRequireAdminIdentity(required: boolean | undefined): void {
  requireAdminOverride = required;
}

// Is `address` in the ADMINS allowlist (the Studio owner gate,
// preview-server/request-auth.ts)? Case-insensitive; empty/unset
// allowlist matches nothing (comma- or whitespace-separated wallet addresses).
export function isAdminAddress(
  address: string | undefined,
  adminsEnv: string | undefined,
): boolean {
  if (!address) return false;
  const admins = (adminsEnv ?? "")
    .split(/[\s,]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(address.toLowerCase());
}
