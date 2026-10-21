/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type {
  AcceptSourceNoticeAction,
  KeepVariantAction,
  SetNotesEnabledAction,
  SetOriginAction,
  SetPublicSourceAction,
  SetReviewSuggestionsAction,
  SetUpstreamVersionAction,
  SetVariantStatusAction,
  StartVariantsAction,
} from "./actions.js";

export interface StudioProductIterateOperations {
  setReviewSuggestionsOperation: (
    state: StudioProductGlobalState,
    action: SetReviewSuggestionsAction,
    dispatch?: SignalDispatch,
  ) => void;
  startVariantsOperation: (
    state: StudioProductGlobalState,
    action: StartVariantsAction,
    dispatch?: SignalDispatch,
  ) => void;
  setVariantStatusOperation: (
    state: StudioProductGlobalState,
    action: SetVariantStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  keepVariantOperation: (
    state: StudioProductGlobalState,
    action: KeepVariantAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOriginOperation: (
    state: StudioProductGlobalState,
    action: SetOriginAction,
    dispatch?: SignalDispatch,
  ) => void;
  setUpstreamVersionOperation: (
    state: StudioProductGlobalState,
    action: SetUpstreamVersionAction,
    dispatch?: SignalDispatch,
  ) => void;
  setNotesEnabledOperation: (
    state: StudioProductGlobalState,
    action: SetNotesEnabledAction,
    dispatch?: SignalDispatch,
  ) => void;
  acceptSourceNoticeOperation: (
    state: StudioProductGlobalState,
    action: AcceptSourceNoticeAction,
    dispatch?: SignalDispatch,
  ) => void;
  setPublicSourceOperation: (
    state: StudioProductGlobalState,
    action: SetPublicSourceAction,
    dispatch?: SignalDispatch,
  ) => void;
}
