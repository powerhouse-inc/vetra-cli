/**
 * Client for the preview server's team routes (P6 task 1.9, used by the Team
 * panel in 1.12).
 *
 * `GET /team/me` and `GET /team/members` carry the signed-in person's
 * Studio-bound Renown bearer (the member gate resolves them to their role).
 * The roster is what *this Studio has seen*: the members the daemon admitted
 * plus the accepted reviewers. An organisation's full member list cannot be
 * read from the Studio (Renown's organizationMembers needs a wallet-signed
 * OrgAuthInput the daemon cannot produce, the 1.10 gap), so `limited` says so
 * and the panel states it instead of inventing members.
 */
import type { Member } from "./capabilities.js";
import type { Node } from "@powerhousedao/shared/document-drive";
import {
  ownerHeaders,
  resolvePreviewConfig,
} from "../hooks/preview-server-client.js";

/** The team-document type the Studio page reads the roster from. */
export const STUDIO_TEAM_TYPE = "vetra/studio-team";

/** A roster row: the member plus what this Studio knows about their access. */
export type TeamMember = Member & {
  /** The member allowed the Studio's agent (their own delegation, 1.11). */
  allowedAgent: boolean;
  /** An Owner limited this member to watching here (VIEWER role override). */
  overridden: boolean;
};

export interface TeamMe {
  member: Member | null;
  orgId: string | null;
  /** An Owner/Maker who has not allowed the Studio's agent yet. */
  needsAllow: boolean;
}

export interface TeamRoster {
  orgId: string | null;
  members: TeamMember[];
  /** The list is the members this Studio has seen, not the org's full list. */
  limited: boolean;
}

export class TeamUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "TeamUnavailableError";
  }
}

async function teamJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}${path}`, {
    headers: await ownerHeaders(),
    signal,
  });
  if (!res.ok) {
    throw new TeamUnavailableError(`preview-server ${path}: ${res.status}`);
  }
  return (await res.json()) as T;
}

/** The caller's own member record (role, reviewer, org, agent access). */
export async function fetchTeamMe(signal?: AbortSignal): Promise<TeamMe> {
  return teamJson<TeamMe>("/team/me", signal);
}

/** The members this Studio has seen, with their agent delegations. */
export async function fetchTeamMembers(
  signal?: AbortSignal,
): Promise<TeamRoster> {
  return teamJson<TeamRoster>("/team/members", signal);
}

/** The team document in the Studio drive, or null before it exists (C16:
 * a fresh org Studio's team document waits for a member's delegation). */
export function teamDocumentId(nodes: readonly Node[]): string | null {
  for (const node of nodes) {
    if (node.kind !== "file") continue;
    if ("documentType" in node && node.documentType === STUDIO_TEAM_TYPE) {
      return node.id;
    }
  }
  return null;
}

/** The display name for a member: their name, else a short address. */
export function memberName(
  member: Pick<Member, "name" | "address">,
  you = false,
): string {
  const name = member.name?.trim();
  const label = name || shortAddress(member.address);
  return you ? `${label} (you)` : label;
}

export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
