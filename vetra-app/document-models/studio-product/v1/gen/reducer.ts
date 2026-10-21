/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { StudioProductPHState } from "document-models/studio-product/v1";

import { studioProductChangeOperations } from "../src/reducers/change.js";
import { studioProductIterateOperations } from "../src/reducers/iterate.js";
import { studioProductLaunchOperations } from "../src/reducers/launch.js";
import { studioProductProductOperations } from "../src/reducers/product.js";
import { studioProductSuggestionsOperations } from "../src/reducers/suggestions.js";
import { studioProductWorkshopOperations } from "../src/reducers/workshop.js";

import {
  AcceptSourceNoticeInputSchema,
  AddMilestoneInputSchema,
  AdoptExistingInputSchema,
  AnswerQuestionInputSchema,
  AskQuestionInputSchema,
  ClearRequestInputSchema,
  ClearStuckInputSchema,
  CompleteLaunchInputSchema,
  CompleteStepInputSchema,
  CountStepInputSchema,
  DiscardChangeInputSchema,
  DismissSuggestionInputSchema,
  FailLaunchInputSchema,
  FailRequestInputSchema,
  FinishRowImportInputSchema,
  InitProductInputSchema,
  KeepVariantInputSchema,
  MarkExplainersSeenInputSchema,
  MarkStuckInputSchema,
  PauseChangeInputSchema,
  PlanStepsInputSchema,
  RecordChangeMetricsInputSchema,
  RecordCheckRunInputSchema,
  RenameProductInputSchema,
  ReopenStepInputSchema,
  RequestDiscardInputSchema,
  RequestLaunchInputSchema,
  RequestMirrorInputSchema,
  RequestRestartInputSchema,
  RequestRollbackInputSchema,
  ResumeChangeInputSchema,
  SetAccessInputSchema,
  SetChangeCostInputSchema,
  SetChangeTitleInputSchema,
  SetGuidedLoopInputSchema,
  SetHealthInputSchema,
  SetLaunchLineInputSchema,
  SetLaunchPermissionInputSchema,
  SetLiveBeforeVersionsInputSchema,
  SetLiveTargetInputSchema,
  SetLiveVersionInputSchema,
  SetNotesEnabledInputSchema,
  SetOriginInputSchema,
  SetProductDriveInputSchema,
  SetPublicSourceInputSchema,
  SetReviewSuggestionsInputSchema,
  SetRollbackBlockInputSchema,
  SetStepAttentionInputSchema,
  SetSuggestionsInputSchema,
  SetUnderstoodInputSchema,
  SetUpstreamVersionInputSchema,
  SetVariantStatusInputSchema,
  StartChangeInputSchema,
  StartLaunchInputSchema,
  StartRowImportInputSchema,
  StartStepInputSchema,
  StartVariantsInputSchema,
  UseSuggestionInputSchema,
  WaiveLintInputSchema,
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

const stateReducer: StateReducer<StudioProductPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INIT_PRODUCT": {
      memoizedSchema(InitProductInputSchema).parse(action.input);

      studioProductProductOperations.initProductOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RENAME_PRODUCT": {
      memoizedSchema(RenameProductInputSchema).parse(action.input);

      studioProductProductOperations.renameProductOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ACCESS": {
      memoizedSchema(SetAccessInputSchema).parse(action.input);

      studioProductProductOperations.setAccessOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "START_CHANGE": {
      memoizedSchema(StartChangeInputSchema).parse(action.input);

      studioProductChangeOperations.startChangeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADOPT_EXISTING": {
      memoizedSchema(AdoptExistingInputSchema).parse(action.input);

      studioProductChangeOperations.adoptExistingOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LIVE_BEFORE_VERSIONS": {
      memoizedSchema(SetLiveBeforeVersionsInputSchema).parse(action.input);

      studioProductChangeOperations.setLiveBeforeVersionsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PLAN_STEPS": {
      memoizedSchema(PlanStepsInputSchema).parse(action.input);

      studioProductChangeOperations.planStepsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "START_STEP": {
      memoizedSchema(StartStepInputSchema).parse(action.input);

      studioProductChangeOperations.startStepOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "COUNT_STEP": {
      memoizedSchema(CountStepInputSchema).parse(action.input);

      studioProductChangeOperations.countStepOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "COMPLETE_STEP": {
      memoizedSchema(CompleteStepInputSchema).parse(action.input);

      studioProductChangeOperations.completeStepOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REOPEN_STEP": {
      memoizedSchema(ReopenStepInputSchema).parse(action.input);

      studioProductChangeOperations.reopenStepOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_MILESTONE": {
      memoizedSchema(AddMilestoneInputSchema).parse(action.input);

      studioProductChangeOperations.addMilestoneOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RECORD_CHECK_RUN": {
      memoizedSchema(RecordCheckRunInputSchema).parse(action.input);

      studioProductChangeOperations.recordCheckRunOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "MARK_STUCK": {
      memoizedSchema(MarkStuckInputSchema).parse(action.input);

      studioProductChangeOperations.markStuckOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "CLEAR_STUCK": {
      memoizedSchema(ClearStuckInputSchema).parse(action.input);

      studioProductChangeOperations.clearStuckOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_STEP_ATTENTION": {
      memoizedSchema(SetStepAttentionInputSchema).parse(action.input);

      studioProductChangeOperations.setStepAttentionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PAUSE_CHANGE": {
      memoizedSchema(PauseChangeInputSchema).parse(action.input);

      studioProductChangeOperations.pauseChangeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RESUME_CHANGE": {
      memoizedSchema(ResumeChangeInputSchema).parse(action.input);

      studioProductChangeOperations.resumeChangeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RECORD_CHANGE_METRICS": {
      memoizedSchema(RecordChangeMetricsInputSchema).parse(action.input);

      studioProductChangeOperations.recordChangeMetricsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CHANGE_TITLE": {
      memoizedSchema(SetChangeTitleInputSchema).parse(action.input);

      studioProductChangeOperations.setChangeTitleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "WAIVE_LINT": {
      memoizedSchema(WaiveLintInputSchema).parse(action.input);

      studioProductChangeOperations.waiveLintOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "DISCARD_CHANGE": {
      memoizedSchema(DiscardChangeInputSchema).parse(action.input);

      studioProductChangeOperations.discardChangeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LIVE_TARGET": {
      memoizedSchema(SetLiveTargetInputSchema).parse(action.input);

      studioProductLaunchOperations.setLiveTargetOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PRODUCT_DRIVE": {
      memoizedSchema(SetProductDriveInputSchema).parse(action.input);

      studioProductLaunchOperations.setProductDriveOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REQUEST_LAUNCH": {
      memoizedSchema(RequestLaunchInputSchema).parse(action.input);

      studioProductLaunchOperations.requestLaunchOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REQUEST_ROLLBACK": {
      memoizedSchema(RequestRollbackInputSchema).parse(action.input);

      studioProductLaunchOperations.requestRollbackOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REQUEST_DISCARD": {
      memoizedSchema(RequestDiscardInputSchema).parse(action.input);

      studioProductLaunchOperations.requestDiscardOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REQUEST_RESTART": {
      memoizedSchema(RequestRestartInputSchema).parse(action.input);

      studioProductLaunchOperations.requestRestartOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REQUEST_MIRROR": {
      memoizedSchema(RequestMirrorInputSchema).parse(action.input);

      studioProductLaunchOperations.requestMirrorOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "CLEAR_REQUEST": {
      memoizedSchema(ClearRequestInputSchema).parse(action.input);

      studioProductLaunchOperations.clearRequestOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "FAIL_REQUEST": {
      memoizedSchema(FailRequestInputSchema).parse(action.input);

      studioProductLaunchOperations.failRequestOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "START_LAUNCH": {
      memoizedSchema(StartLaunchInputSchema).parse(action.input);

      studioProductLaunchOperations.startLaunchOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LAUNCH_LINE": {
      memoizedSchema(SetLaunchLineInputSchema).parse(action.input);

      studioProductLaunchOperations.setLaunchLineOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "COMPLETE_LAUNCH": {
      memoizedSchema(CompleteLaunchInputSchema).parse(action.input);

      studioProductLaunchOperations.completeLaunchOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "FAIL_LAUNCH": {
      memoizedSchema(FailLaunchInputSchema).parse(action.input);

      studioProductLaunchOperations.failLaunchOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LIVE_VERSION": {
      memoizedSchema(SetLiveVersionInputSchema).parse(action.input);

      studioProductLaunchOperations.setLiveVersionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_HEALTH": {
      memoizedSchema(SetHealthInputSchema).parse(action.input);

      studioProductLaunchOperations.setHealthOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LAUNCH_PERMISSION": {
      memoizedSchema(SetLaunchPermissionInputSchema).parse(action.input);

      studioProductLaunchOperations.setLaunchPermissionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ROLLBACK_BLOCK": {
      memoizedSchema(SetRollbackBlockInputSchema).parse(action.input);

      studioProductLaunchOperations.setRollbackBlockOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_SUGGESTIONS": {
      memoizedSchema(SetSuggestionsInputSchema).parse(action.input);

      studioProductSuggestionsOperations.setSuggestionsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "USE_SUGGESTION": {
      memoizedSchema(UseSuggestionInputSchema).parse(action.input);

      studioProductSuggestionsOperations.useSuggestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "DISMISS_SUGGESTION": {
      memoizedSchema(DismissSuggestionInputSchema).parse(action.input);

      studioProductSuggestionsOperations.dismissSuggestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_REVIEW_SUGGESTIONS": {
      memoizedSchema(SetReviewSuggestionsInputSchema).parse(action.input);

      studioProductIterateOperations.setReviewSuggestionsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "START_VARIANTS": {
      memoizedSchema(StartVariantsInputSchema).parse(action.input);

      studioProductIterateOperations.startVariantsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_VARIANT_STATUS": {
      memoizedSchema(SetVariantStatusInputSchema).parse(action.input);

      studioProductIterateOperations.setVariantStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "KEEP_VARIANT": {
      memoizedSchema(KeepVariantInputSchema).parse(action.input);

      studioProductIterateOperations.keepVariantOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ORIGIN": {
      memoizedSchema(SetOriginInputSchema).parse(action.input);

      studioProductIterateOperations.setOriginOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_UPSTREAM_VERSION": {
      memoizedSchema(SetUpstreamVersionInputSchema).parse(action.input);

      studioProductIterateOperations.setUpstreamVersionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_NOTES_ENABLED": {
      memoizedSchema(SetNotesEnabledInputSchema).parse(action.input);

      studioProductIterateOperations.setNotesEnabledOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ACCEPT_SOURCE_NOTICE": {
      memoizedSchema(AcceptSourceNoticeInputSchema).parse(action.input);

      studioProductIterateOperations.acceptSourceNoticeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PUBLIC_SOURCE": {
      memoizedSchema(SetPublicSourceInputSchema).parse(action.input);

      studioProductIterateOperations.setPublicSourceOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_UNDERSTOOD": {
      memoizedSchema(SetUnderstoodInputSchema).parse(action.input);

      studioProductWorkshopOperations.setUnderstoodOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "MARK_EXPLAINERS_SEEN": {
      memoizedSchema(MarkExplainersSeenInputSchema).parse(action.input);

      studioProductWorkshopOperations.markExplainersSeenOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_GUIDED_LOOP": {
      memoizedSchema(SetGuidedLoopInputSchema).parse(action.input);

      studioProductWorkshopOperations.setGuidedLoopOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ASK_QUESTION": {
      memoizedSchema(AskQuestionInputSchema).parse(action.input);

      studioProductWorkshopOperations.askQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ANSWER_QUESTION": {
      memoizedSchema(AnswerQuestionInputSchema).parse(action.input);

      studioProductWorkshopOperations.answerQuestionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CHANGE_COST": {
      memoizedSchema(SetChangeCostInputSchema).parse(action.input);

      studioProductWorkshopOperations.setChangeCostOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "START_ROW_IMPORT": {
      memoizedSchema(StartRowImportInputSchema).parse(action.input);

      studioProductWorkshopOperations.startRowImportOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "FINISH_ROW_IMPORT": {
      memoizedSchema(FinishRowImportInputSchema).parse(action.input);

      studioProductWorkshopOperations.finishRowImportOperation(
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

export const reducer: Reducer<StudioProductPHState> =
  createReducer(stateReducer);
