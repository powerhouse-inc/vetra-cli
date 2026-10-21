// Studio roles. The capability table itself lives in vetra-app so the browser
// and this process share one definition (P6, ruling C1).
import {
  CAPABILITIES,
  type Capability,
  type Member,
  type StudioRoleName,
} from "vetra-app/studio-team";

import type { OrgMembership } from "./renown-orgs.js";

export { CAPABILITIES };
export type { Capability, Member, StudioRoleName };

/**
 * Cloud's rule (shared/org-access.ts hasPublisherCapability): OWNER/ADMIN
 * always; PUBLISHER when there is no app, the scope is all, or it lists the
 * Studio app's DID.
 */
export function publisherCapable(
  m: Pick<OrgMembership, "role" | "effectiveScope">,
  appDid: string | null,
): boolean {
  if (m.role === "OWNER" || m.role === "ADMIN") return true;
  if (m.role !== "PUBLISHER") return false;
  return !appDid || m.effectiveScope.all || m.effectiveScope.appDids.includes(appDid);
}

/** P6-1: OWNER/ADMIN -> owner, capable PUBLISHER -> maker, everyone else active -> viewer. */
export function mapOrgRole(m: {
  role: "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER";
  status: string;
  publisherCapable: boolean;
}): StudioRoleName | null {
  if (m.status !== "ACTIVE") return null;
  if (m.role === "OWNER" || m.role === "ADMIN") return "owner";
  if (m.role === "PUBLISHER" && m.publisherCapable) return "maker";
  return "viewer";
}
