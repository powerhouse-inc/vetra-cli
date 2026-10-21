import type { StudioTeamLimitsOperations } from "document-models/studio-team/v1";
import { InvalidLimitError } from "../../gen/limits/error.js";
import { normalizeTeam } from "../normalize.js";

export const studioTeamLimitsOperations: StudioTeamLimitsOperations = {
  setMemberLimitOperation(state, action) {
    normalizeTeam(state);
    if (action.input.monthlyUsd < 0) {
      throw new InvalidLimitError("The limit cannot be negative.");
    }
    const address = action.input.address.toLowerCase();
    const entry = {
      address,
      monthlyUsd: action.input.monthlyUsd,
      at: action.input.at,
    };
    const index = state.memberLimits.findIndex((l) => l.address === address);
    if (index === -1) state.memberLimits.push(entry);
    else state.memberLimits[index] = entry;
  },
  clearMemberLimitOperation(state, action) {
    normalizeTeam(state);
    const address = action.input.address.toLowerCase();
    state.memberLimits = state.memberLimits.filter(
      (l) => l.address !== address,
    );
  },
};
