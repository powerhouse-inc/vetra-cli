export type ErrorCode =
  | "TeamAlreadyInitializedError"
  | "DuplicateReviewerError"
  | "ReviewerNotFoundError"
  | "InvalidOverrideError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class TeamAlreadyInitializedError extends Error implements ReducerError {
  errorCode = "TeamAlreadyInitializedError" as ErrorCode;
  constructor(message = "TeamAlreadyInitializedError") {
    super(message);
  }
}

export class DuplicateReviewerError extends Error implements ReducerError {
  errorCode = "DuplicateReviewerError" as ErrorCode;
  constructor(message = "DuplicateReviewerError") {
    super(message);
  }
}

export class ReviewerNotFoundError extends Error implements ReducerError {
  errorCode = "ReviewerNotFoundError" as ErrorCode;
  constructor(message = "ReviewerNotFoundError") {
    super(message);
  }
}

export class InvalidOverrideError extends Error implements ReducerError {
  errorCode = "InvalidOverrideError" as ErrorCode;
  constructor(message = "InvalidOverrideError") {
    super(message);
  }
}

export const errors = {
  InitTeam: { TeamAlreadyInitializedError },

  AddReviewer: { DuplicateReviewerError },

  RemoveReviewer: { ReviewerNotFoundError },

  SetRoleOverride: { InvalidOverrideError },
};
