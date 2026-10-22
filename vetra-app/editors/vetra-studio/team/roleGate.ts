/**
 * The page's role gates (P6 task 1.12), expressed with the one capability
 * table the Studio process also imports (`team/capabilities.ts`, Ruling C1) —
 * the browser and the daemon cannot disagree about what a role may do.
 *
 * Where the table needs a change owner the browser does not have yet (the
 * START_CHANGE signer lives in the product document's signed operations), the
 * page gates on the role: M2 narrows steering to the change's owner.
 * `me === null` means "no team information" (a local Studio, an older daemon,
 * or a Renown outage): the page behaves as before and the server still
 * enforces every route.
 */
import {
  CAPABILITIES,
  type Capability,
  type CapabilityContext,
  type Member,
  type StudioRoleName,
} from "./capabilities.js";

/** Shown where a Viewer's steer box would be. */
export const VIEWER_STEER_TEXT =
  "You can watch and comment. Ask an Owner if you want to make changes.";

/** The role names as the Studio writes them. */
export const ROLE_NAMES: Record<StudioRoleName, string> = {
  owner: "Owner",
  maker: "Maker",
  viewer: "Viewer",
  guest: "Guest",
};

/** `can(me, cap)`: the shared table; no team information never gates. */
export function can(
  me: Member | null,
  cap: Capability,
  ctx: CapabilityContext = {},
): boolean {
  if (!me) return true;
  return CAPABILITIES[cap](me, ctx);
}

/** Whether the page shows the steer box (role level; M2 adds the owner). */
export function canSteer(
  me: Member | null,
  ctx: CapabilityContext = {},
): boolean {
  if (!me) return true;
  if (me.role === "owner" || me.role === "maker") return true;
  // A guest may comment on their own change; the table knows the invite.
  return CAPABILITIES.steer(me, ctx);
}

/** Whether the page offers Make it live / Keep changing (Owner, Maker). */
export function canLaunch(me: Member | null): boolean {
  return can(me, "launch");
}

/** Owner-only controls (team settings, Move into an organisation). */
export function canManageTeam(me: Member | null): boolean {
  return can(me, "manageTeam");
}

/** A Maker the Owner limited to watching here (VIEWER override). */
export function limitedToWatching(
  member: Pick<Member, "role"> & { overridden?: boolean },
): boolean {
  return member.overridden === true || member.role === "viewer";
}
