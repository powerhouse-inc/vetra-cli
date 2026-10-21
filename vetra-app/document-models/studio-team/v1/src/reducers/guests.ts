import type { StudioTeamGuestsOperations } from "document-models/studio-team/v1";
import {
  DuplicateGuestError,
  GuestNotFoundError,
  InvalidGuestExpiryError,
} from "../../gen/guests/error.js";
import { normalizeTeam } from "../normalize.js";

/** Longest allowed invitation, from the moment it is sent. */
const MAX_INVITE_MS = 30 * 24 * 60 * 60 * 1000;

export const studioTeamGuestsOperations: StudioTeamGuestsOperations = {
  inviteGuestOperation(state, action) {
    normalizeTeam(state);
    const input = action.input;
    if (state.guests.some((g) => g.id === input.id)) {
      throw new DuplicateGuestError("A guest with this id already exists.");
    }
    const invitedAt = Date.parse(input.invitedAt);
    const expiresAt = Date.parse(input.expiresAt);
    // `!(a > b)` also rejects unparsable dates (NaN).
    if (!(expiresAt > invitedAt) || expiresAt > invitedAt + MAX_INVITE_MS) {
      throw new InvalidGuestExpiryError(
        "The expiry must be after the invitation and at most 30 days later.",
      );
    }
    state.guests.push({
      id: input.id,
      address: input.address.toLowerCase(),
      name: input.name ?? null,
      changeId: input.changeId,
      rights: input.rights,
      expiresAt: input.expiresAt,
      invitedAt: input.invitedAt,
      revokedAt: null,
    });
  },
  revokeGuestOperation(state, action) {
    normalizeTeam(state);
    const guest = state.guests.find((g) => g.id === action.input.id);
    if (!guest) throw new GuestNotFoundError("No guest with this id.");
    guest.revokedAt ??= action.input.at;
  },
};
