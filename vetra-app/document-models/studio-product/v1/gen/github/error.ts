export type ErrorCode =
  | "MissingRepoError"
  | "InvalidRepoNameError"
  | "MissingReasonError"
  | "GithubNotConnectedError"
  | "InvalidShaError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class MissingRepoError extends Error implements ReducerError {
  errorCode = "MissingRepoError" as ErrorCode;
  constructor(message = "MissingRepoError") {
    super(message);
  }
}

export class InvalidRepoNameError extends Error implements ReducerError {
  errorCode = "InvalidRepoNameError" as ErrorCode;
  constructor(message = "InvalidRepoNameError") {
    super(message);
  }
}

export class MissingReasonError extends Error implements ReducerError {
  errorCode = "MissingReasonError" as ErrorCode;
  constructor(message = "MissingReasonError") {
    super(message);
  }
}

export class GithubNotConnectedError extends Error implements ReducerError {
  errorCode = "GithubNotConnectedError" as ErrorCode;
  constructor(message = "GithubNotConnectedError") {
    super(message);
  }
}

export class InvalidShaError extends Error implements ReducerError {
  errorCode = "InvalidShaError" as ErrorCode;
  constructor(message = "InvalidShaError") {
    super(message);
  }
}

export const errors = {
  SetGithub: { MissingRepoError, InvalidRepoNameError, MissingReasonError },

  SetExternalChanges: { GithubNotConnectedError, InvalidShaError },
};
