// The Studio capability table, shared by the browser and the Studio process
// (vetra-cli imports it through "vetra-app/studio-team") so the two sides
// cannot drift. Pure: no React, no I/O.

export type StudioRoleName = "owner" | "maker" | "viewer" | "guest";

export type GuestRightsName = "COMMENT" | "COMMENT_STEER";

export type Member = {
  address: string;
  name: string | null;
  role: StudioRoleName;
  reviewer: boolean;
  guest?: {
    id: string;
    changeId: string;
    rights: GuestRightsName;
    expiresAt: string;
  };
};

export type Capability =
  | "view"
  | "comment"
  | "steer"
  | "startChange"
  | "launch"
  | "requestReview"
  | "approve"
  | "triage"
  | "manageTeam"
  | "adopt"
  | "exportWorkspace"
  | "restart"
  | "allowAgent"
  | "auditExport"
  | "budgetBreakdown";

export type CapabilityContext = { changeOwner?: string; changeId?: string };

const isOwner = (m: Member) => m.role === "owner";
const isOwnerOrMaker = (m: Member) => m.role === "owner" || m.role === "maker";

/** A guest sees and comments on their own change only. */
const guestOnChange = (m: Member, ctx: CapabilityContext) =>
  m.role === "guest" &&
  !!m.guest &&
  ctx.changeId !== undefined &&
  m.guest.changeId === ctx.changeId;

const isMember = (m: Member) => m.role !== "guest";

export const CAPABILITIES: Record<
  Capability,
  (m: Member, ctx: CapabilityContext) => boolean
> = {
  view: (m, ctx) => isMember(m) || guestOnChange(m, ctx),
  comment: (m, ctx) => isMember(m) || guestOnChange(m, ctx),
  steer: (m, ctx) => {
    if (isOwnerOrMaker(m)) {
      return (
        ctx.changeOwner !== undefined &&
        ctx.changeOwner.toLowerCase() === m.address.toLowerCase()
      );
    }
    return guestOnChange(m, ctx) && m.guest?.rights === "COMMENT_STEER";
  },
  startChange: isOwnerOrMaker,
  launch: isOwnerOrMaker,
  requestReview: isOwnerOrMaker,
  // Four-eyes (approver is not the requester/owner) is enforced in M4.
  approve: (m) => isMember(m) && m.reviewer,
  // Until the handbook's Triage responsibility exists (M7): owner only.
  triage: isOwner,
  manageTeam: isOwner,
  adopt: isOwner,
  exportWorkspace: isOwner,
  restart: isOwner,
  allowAgent: isOwnerOrMaker,
  auditExport: isOwner,
  budgetBreakdown: isOwner,
};
