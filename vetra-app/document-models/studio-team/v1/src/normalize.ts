import type { Guest, StudioTeamState } from "../gen/schema/types.js";

/**
 * Documents written by earlier builds may lack fields that were added to the
 * state later. Every reducer and every reader passes the state through here
 * first: missing lists become `[]`, missing nullable fields `null` and missing
 * flags their initial value. Fills in place and returns the same object.
 */
export function normalizeTeam(state: StudioTeamState): StudioTeamState {
  const s: Partial<StudioTeamState> = state;
  s.orgId ??= null;
  s.reviewRequired ??= false;
  s.reviewers ??= [];
  s.roleOverrides ??= [];
  s.guests ??= [];
  s.guests.forEach(normalizeGuest);
  s.memberLimits ??= [];
  return state;
}

function normalizeGuest(guest: Guest): void {
  const g: Partial<Guest> = guest;
  g.name ??= null;
  g.revokedAt ??= null;
}
