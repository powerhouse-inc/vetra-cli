export type ErrorCode =
  | "ChangeInProgressError"
  | "DuplicateChangeIdError"
  | "InvalidChangeKindError"
  | "AdoptNotAllowedError"
  | "ChangeNotFoundError"
  | "InvalidChangeStatusError"
  | "DuplicateStepKindError"
  | "InvalidCountError"
  | "StepNotPlannedError"
  | "GateNotMetError"
  | "StepNotDoneError"
  | "DuplicateMilestoneIdError"
  | "DuplicateCheckRunIdError"
  | "DuplicateCheckKindError"
  | "InvalidAttentionStatusError"
  | "NothingToWaiveError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class ChangeInProgressError extends Error implements ReducerError {
  errorCode = "ChangeInProgressError" as ErrorCode;
  constructor(message = "ChangeInProgressError") {
    super(message);
  }
}

export class DuplicateChangeIdError extends Error implements ReducerError {
  errorCode = "DuplicateChangeIdError" as ErrorCode;
  constructor(message = "DuplicateChangeIdError") {
    super(message);
  }
}

export class InvalidChangeKindError extends Error implements ReducerError {
  errorCode = "InvalidChangeKindError" as ErrorCode;
  constructor(message = "InvalidChangeKindError") {
    super(message);
  }
}

export class AdoptNotAllowedError extends Error implements ReducerError {
  errorCode = "AdoptNotAllowedError" as ErrorCode;
  constructor(message = "AdoptNotAllowedError") {
    super(message);
  }
}

export class ChangeNotFoundError extends Error implements ReducerError {
  errorCode = "ChangeNotFoundError" as ErrorCode;
  constructor(message = "ChangeNotFoundError") {
    super(message);
  }
}

export class InvalidChangeStatusError extends Error implements ReducerError {
  errorCode = "InvalidChangeStatusError" as ErrorCode;
  constructor(message = "InvalidChangeStatusError") {
    super(message);
  }
}

export class DuplicateStepKindError extends Error implements ReducerError {
  errorCode = "DuplicateStepKindError" as ErrorCode;
  constructor(message = "DuplicateStepKindError") {
    super(message);
  }
}

export class InvalidCountError extends Error implements ReducerError {
  errorCode = "InvalidCountError" as ErrorCode;
  constructor(message = "InvalidCountError") {
    super(message);
  }
}

export class StepNotPlannedError extends Error implements ReducerError {
  errorCode = "StepNotPlannedError" as ErrorCode;
  constructor(message = "StepNotPlannedError") {
    super(message);
  }
}

export class GateNotMetError extends Error implements ReducerError {
  errorCode = "GateNotMetError" as ErrorCode;
  constructor(message = "GateNotMetError") {
    super(message);
  }
}

export class StepNotDoneError extends Error implements ReducerError {
  errorCode = "StepNotDoneError" as ErrorCode;
  constructor(message = "StepNotDoneError") {
    super(message);
  }
}

export class DuplicateMilestoneIdError extends Error implements ReducerError {
  errorCode = "DuplicateMilestoneIdError" as ErrorCode;
  constructor(message = "DuplicateMilestoneIdError") {
    super(message);
  }
}

export class DuplicateCheckRunIdError extends Error implements ReducerError {
  errorCode = "DuplicateCheckRunIdError" as ErrorCode;
  constructor(message = "DuplicateCheckRunIdError") {
    super(message);
  }
}

export class DuplicateCheckKindError extends Error implements ReducerError {
  errorCode = "DuplicateCheckKindError" as ErrorCode;
  constructor(message = "DuplicateCheckKindError") {
    super(message);
  }
}

export class InvalidAttentionStatusError extends Error implements ReducerError {
  errorCode = "InvalidAttentionStatusError" as ErrorCode;
  constructor(message = "InvalidAttentionStatusError") {
    super(message);
  }
}

export class NothingToWaiveError extends Error implements ReducerError {
  errorCode = "NothingToWaiveError" as ErrorCode;
  constructor(message = "NothingToWaiveError") {
    super(message);
  }
}

export const errors = {
  StartChange: {
    ChangeInProgressError,
    DuplicateChangeIdError,
    InvalidChangeKindError,
  },

  AdoptExisting: { AdoptNotAllowedError },

  PlanSteps: {
    ChangeNotFoundError,
    InvalidChangeStatusError,
    DuplicateStepKindError,
    InvalidCountError,
  },

  StartStep: { StepNotPlannedError },

  CompleteStep: { GateNotMetError },

  ReopenStep: { StepNotDoneError },

  AddMilestone: { DuplicateMilestoneIdError },

  RecordCheckRun: { DuplicateCheckRunIdError, DuplicateCheckKindError },

  SetStepAttention: { InvalidAttentionStatusError },

  WaiveLint: { NothingToWaiveError },
};
