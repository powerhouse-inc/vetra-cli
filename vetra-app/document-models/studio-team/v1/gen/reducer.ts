/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { StudioTeamPHState } from "document-models/studio-team/v1";

import { studioTeamGuestsOperations } from "../src/reducers/guests.js";
import { studioTeamLimitsOperations } from "../src/reducers/limits.js";
import { studioTeamTeamOperations } from "../src/reducers/team.js";

import {
  AddReviewerInputSchema,
  ClearMemberLimitInputSchema,
  ClearRoleOverrideInputSchema,
  InitTeamInputSchema,
  InviteGuestInputSchema,
  RemoveReviewerInputSchema,
  RevokeGuestInputSchema,
  SetMemberLimitInputSchema,
  SetReviewRequiredInputSchema,
  SetRoleOverrideInputSchema,
} from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

const stateReducer: StateReducer<StudioTeamPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INIT_TEAM": {
      memoizedSchema(InitTeamInputSchema).parse(action.input);

      studioTeamTeamOperations.initTeamOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_REVIEW_REQUIRED": {
      memoizedSchema(SetReviewRequiredInputSchema).parse(action.input);

      studioTeamTeamOperations.setReviewRequiredOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_REVIEWER": {
      memoizedSchema(AddReviewerInputSchema).parse(action.input);

      studioTeamTeamOperations.addReviewerOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_REVIEWER": {
      memoizedSchema(RemoveReviewerInputSchema).parse(action.input);

      studioTeamTeamOperations.removeReviewerOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ROLE_OVERRIDE": {
      memoizedSchema(SetRoleOverrideInputSchema).parse(action.input);

      studioTeamTeamOperations.setRoleOverrideOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "CLEAR_ROLE_OVERRIDE": {
      memoizedSchema(ClearRoleOverrideInputSchema).parse(action.input);

      studioTeamTeamOperations.clearRoleOverrideOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "INVITE_GUEST": {
      memoizedSchema(InviteGuestInputSchema).parse(action.input);

      studioTeamGuestsOperations.inviteGuestOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REVOKE_GUEST": {
      memoizedSchema(RevokeGuestInputSchema).parse(action.input);

      studioTeamGuestsOperations.revokeGuestOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBER_LIMIT": {
      memoizedSchema(SetMemberLimitInputSchema).parse(action.input);

      studioTeamLimitsOperations.setMemberLimitOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "CLEAR_MEMBER_LIMIT": {
      memoizedSchema(ClearMemberLimitInputSchema).parse(action.input);

      studioTeamLimitsOperations.clearMemberLimitOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<StudioTeamPHState> = createReducer(stateReducer);
