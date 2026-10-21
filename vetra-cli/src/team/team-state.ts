/**
 * The team state membership may trust (P6-2, Ruling C2): the team document's
 * operations are judged by the trust ledger against the signer's *base* role
 * (never against team state), and only accepted operations shape the state.
 *
 * - A document whose accepted `INIT_TEAM` names another organisation is
 *   refused: the pod's `VETRA_STUDIO_ORG_ID` decides which org this Studio is.
 * - Reviewers are accepted `ADD_REVIEWER` minus accepted `REMOVE_REVIEWER`
 *   (the membership module only flags the survivors).
 * - `onAcceptedChange` fires when the accepted team operations change, so the
 *   membership cache can be invalidated before it serves a stale verdict.
 */
import type {
  AddReviewerInput,
  ClearMemberLimitInput,
  ClearRoleOverrideInput,
  InitTeamInput,
  InviteGuestInput,
  RemoveReviewerInput,
  RevokeGuestInput,
  SetMemberLimitInput,
  SetReviewRequiredInput,
  SetRoleOverrideInput,
  StudioTeamState,
} from "vetra-app/document-models/studio-team";

import { CAPABILITIES, type Member } from "./roles.js";
import type { Operation, TrustLedger } from "./trust.js";

type TeamPerson = StudioTeamState["reviewers"][number];
type RoleOverride = StudioTeamState["roleOverrides"][number];
type Guest = StudioTeamState["guests"][number];
type MemberLimit = StudioTeamState["memberLimits"][number];

/** The operations of the team document that security decisions read. */
export const TEAM_OPERATION_TYPES: Readonly<Record<string, true>> = {
  INIT_TEAM: true,
  SET_REVIEW_REQUIRED: true,
  ADD_REVIEWER: true,
  REMOVE_REVIEWER: true,
  SET_ROLE_OVERRIDE: true,
  CLEAR_ROLE_OVERRIDE: true,
  INVITE_GUEST: true,
  REVOKE_GUEST: true,
  SET_MEMBER_LIMIT: true,
  CLEAR_MEMBER_LIMIT: true,
};

const isTeamOperation = (type: string) => TEAM_OPERATION_TYPES[type] === true;

export class TeamDocumentMismatchError extends Error {
  override name = "TeamDocumentMismatchError";
}

export interface TeamDocument {
  documentId: string;
  operations: Operation[];
}

/** The state of a Studio with no accepted team document. Org Studios review by default (C16). */
export function emptyTeamState(orgId: string | null): StudioTeamState {
  return {
    initialized: false,
    orgId: null,
    reviewRequired: orgId !== null,
    reviewers: [],
    roleOverrides: [],
    guests: [],
    memberLimits: [],
  };
}

const lower = (address: string) => address.toLowerCase();

/** Team settings are Owner-only (CAPABILITIES.manageTeam). */
const isTeamManager = (member: Member) => CAPABILITIES.manageTeam(member, {});

/**
 * Judge every team operation of `doc` and build the state from the accepted
 * ones. Throws `TrustUnavailableError` when a lookup cannot answer (the caller
 * refuses), and `TeamDocumentMismatchError` when the document belongs to
 * another organisation.
 */
export async function acceptedTeamState(
  ledger: TrustLedger,
  orgId: string | null,
  doc: TeamDocument,
): Promise<StudioTeamState> {
  const ops = doc.operations.filter((op) => isTeamOperation(op.action.type));
  for (const op of ops) {
    await ledger.judge(doc.documentId, op, isTeamManager);
  }
  const state = emptyTeamState(orgId);
  let initialized = false;
  let initOrg: string | null = null;

  for (const op of ledger.accepted(doc.documentId, ops)) {
    const input = op.action.input as Record<string, unknown>;
    switch (op.action.type) {
      case "INIT_TEAM": {
        if (initialized) break;
        const init = input as unknown as InitTeamInput;
        initialized = true;
        initOrg = init.orgId ?? null;
        state.initialized = true;
        state.orgId = initOrg;
        state.reviewRequired = Boolean(init.reviewRequired);
        break;
      }
      case "SET_REVIEW_REQUIRED": {
        state.reviewRequired = Boolean((input as unknown as SetReviewRequiredInput).required);
        break;
      }
      case "ADD_REVIEWER": {
        const add = input as unknown as AddReviewerInput;
        const address = lower(add.address);
        if (!state.reviewers.some((r: TeamPerson) => lower(r.address) === address)) {
          state.reviewers.push({ address, name: add.name ?? null, addedAt: add.at });
        }
        break;
      }
      case "REMOVE_REVIEWER": {
        const address = lower((input as unknown as RemoveReviewerInput).address);
        state.reviewers = state.reviewers.filter((r: TeamPerson) => lower(r.address) !== address);
        break;
      }
      case "SET_ROLE_OVERRIDE": {
        const set = input as unknown as SetRoleOverrideInput;
        const address = lower(set.address);
        state.roleOverrides = state.roleOverrides.filter(
          (o: RoleOverride) => lower(o.address) !== address,
        );
        state.roleOverrides.push({ address, role: set.role, at: set.at });
        break;
      }
      case "CLEAR_ROLE_OVERRIDE": {
        const address = lower((input as unknown as ClearRoleOverrideInput).address);
        state.roleOverrides = state.roleOverrides.filter(
          (o: RoleOverride) => lower(o.address) !== address,
        );
        break;
      }
      case "INVITE_GUEST": {
        const invite = input as unknown as InviteGuestInput;
        if (!state.guests.some((g: Guest) => g.id === invite.id)) {
          state.guests.push({
            id: invite.id,
            address: lower(invite.address),
            name: invite.name ?? null,
            changeId: invite.changeId,
            rights: invite.rights,
            expiresAt: invite.expiresAt,
            invitedAt: invite.invitedAt,
            revokedAt: null,
          });
        }
        break;
      }
      case "REVOKE_GUEST": {
        const revoke = input as unknown as RevokeGuestInput;
        state.guests = state.guests.map((g: Guest) =>
          g.id === revoke.id ? { ...g, revokedAt: revoke.at } : g,
        );
        break;
      }
      case "SET_MEMBER_LIMIT": {
        const limit = input as unknown as SetMemberLimitInput;
        const address = lower(limit.address);
        state.memberLimits = state.memberLimits.filter(
          (l: MemberLimit) => lower(l.address) !== address,
        );
        state.memberLimits.push({ address, monthlyUsd: limit.monthlyUsd, at: limit.at });
        break;
      }
      case "CLEAR_MEMBER_LIMIT": {
        const address = lower((input as unknown as ClearMemberLimitInput).address);
        state.memberLimits = state.memberLimits.filter(
          (l: MemberLimit) => lower(l.address) !== address,
        );
        break;
      }
    }
  }

  if (initialized && initOrg !== orgId) {
    throw new TeamDocumentMismatchError(
      `the team document belongs to organisation ${initOrg ?? "(personal)"}, not ${orgId ?? "(personal)"}`,
    );
  }
  return state;
}

export interface AcceptedTeamSource {
  orgId: string | null;
  ledger: TrustLedger;
  readDocument(): Promise<TeamDocument | null>;
  /** Called when the accepted team operations change (wire: membership.invalidate()). */
  onAcceptedChange?: () => void;
}

/**
 * Read + judge the team document, and invalidate the membership cache when the
 * accepted operations changed since the previous read. The first read never
 * invalidates (nothing is cached yet).
 */
export function createAcceptedTeam(source: AcceptedTeamSource): () => Promise<StudioTeamState> {
  let last: string | null = null;
  return async () => {
    const doc = await source.readDocument();
    if (!doc) {
      if (last) source.onAcceptedChange?.();
      last = "";
      return emptyTeamState(source.orgId);
    }
    const state = await acceptedTeamState(source.ledger, source.orgId, doc);
    const accepted = source.ledger
      .accepted(doc.documentId, doc.operations)
      .filter((op) => isTeamOperation(op.action.type));
    const signature = accepted.map((op) => `${op.index}:${op.hash}`).join("|");
    if (last !== null && signature !== last) source.onAcceptedChange?.();
    last = signature;
    return state;
  };
}
