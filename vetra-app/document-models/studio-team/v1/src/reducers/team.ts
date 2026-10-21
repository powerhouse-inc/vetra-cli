import type { StudioTeamTeamOperations } from "document-models/studio-team/v1";
import {
  DuplicateReviewerError,
  InvalidOverrideError,
  ReviewerNotFoundError,
  TeamAlreadyInitializedError,
} from "../../gen/team/error.js";
import { normalizeTeam } from "../normalize.js";

export const studioTeamTeamOperations: StudioTeamTeamOperations = {
  initTeamOperation(state, action) {
    normalizeTeam(state);
    if (state.orgId !== null) {
      throw new TeamAlreadyInitializedError(
        "The team was already initialised.",
      );
    }
    state.orgId = action.input.orgId;
    state.reviewRequired = action.input.reviewRequired;
  },
  setReviewRequiredOperation(state, action) {
    normalizeTeam(state);
    state.reviewRequired = action.input.required;
  },
  addReviewerOperation(state, action) {
    normalizeTeam(state);
    const address = action.input.address.toLowerCase();
    if (state.reviewers.some((r) => r.address === address)) {
      throw new DuplicateReviewerError("This address is already a reviewer.");
    }
    state.reviewers.push({
      address,
      name: action.input.name ?? null,
      addedAt: action.input.at,
    });
  },
  removeReviewerOperation(state, action) {
    normalizeTeam(state);
    const address = action.input.address.toLowerCase();
    const index = state.reviewers.findIndex((r) => r.address === address);
    if (index === -1) {
      throw new ReviewerNotFoundError("No reviewer with this address.");
    }
    state.reviewers.splice(index, 1);
  },
  setRoleOverrideOperation(state, action) {
    normalizeTeam(state);
    if (action.input.role === "OWNER") {
      throw new InvalidOverrideError(
        "OWNER cannot be granted through an override.",
      );
    }
    const address = action.input.address.toLowerCase();
    const entry = { address, role: action.input.role, at: action.input.at };
    const index = state.roleOverrides.findIndex((o) => o.address === address);
    if (index === -1) state.roleOverrides.push(entry);
    else state.roleOverrides[index] = entry;
  },
  clearRoleOverrideOperation(state, action) {
    normalizeTeam(state);
    const address = action.input.address.toLowerCase();
    state.roleOverrides = state.roleOverrides.filter(
      (o) => o.address !== address,
    );
  },
};
