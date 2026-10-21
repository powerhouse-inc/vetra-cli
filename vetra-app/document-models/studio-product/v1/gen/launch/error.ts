export type ErrorCode =
  | "SlugLockedError"
  | "DriveAlreadySetError"
  | "RequestPendingError"
  | "ChangeNotReadyError"
  | "VersionNotFoundError"
  | "InvalidVersionStatusError"
  | "RollbackBlockedError"
  | "NotLiveError"
  | "VersionNumberError"
  | "DuplicatePackageNameError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class SlugLockedError extends Error implements ReducerError {
  errorCode = "SlugLockedError" as ErrorCode;
  constructor(message = "SlugLockedError") {
    super(message);
  }
}

export class DriveAlreadySetError extends Error implements ReducerError {
  errorCode = "DriveAlreadySetError" as ErrorCode;
  constructor(message = "DriveAlreadySetError") {
    super(message);
  }
}

export class RequestPendingError extends Error implements ReducerError {
  errorCode = "RequestPendingError" as ErrorCode;
  constructor(message = "RequestPendingError") {
    super(message);
  }
}

export class ChangeNotReadyError extends Error implements ReducerError {
  errorCode = "ChangeNotReadyError" as ErrorCode;
  constructor(message = "ChangeNotReadyError") {
    super(message);
  }
}

export class VersionNotFoundError extends Error implements ReducerError {
  errorCode = "VersionNotFoundError" as ErrorCode;
  constructor(message = "VersionNotFoundError") {
    super(message);
  }
}

export class InvalidVersionStatusError extends Error implements ReducerError {
  errorCode = "InvalidVersionStatusError" as ErrorCode;
  constructor(message = "InvalidVersionStatusError") {
    super(message);
  }
}

export class RollbackBlockedError extends Error implements ReducerError {
  errorCode = "RollbackBlockedError" as ErrorCode;
  constructor(message = "RollbackBlockedError") {
    super(message);
  }
}

export class NotLiveError extends Error implements ReducerError {
  errorCode = "NotLiveError" as ErrorCode;
  constructor(message = "NotLiveError") {
    super(message);
  }
}

export class VersionNumberError extends Error implements ReducerError {
  errorCode = "VersionNumberError" as ErrorCode;
  constructor(message = "VersionNumberError") {
    super(message);
  }
}

export class DuplicatePackageNameError extends Error implements ReducerError {
  errorCode = "DuplicatePackageNameError" as ErrorCode;
  constructor(message = "DuplicatePackageNameError") {
    super(message);
  }
}

export const errors = {
  SetLiveTarget: { SlugLockedError },

  SetProductDrive: { DriveAlreadySetError },

  RequestLaunch: { RequestPendingError, ChangeNotReadyError },

  RequestRollback: {
    VersionNotFoundError,
    InvalidVersionStatusError,
    RollbackBlockedError,
  },

  RequestRestart: { NotLiveError },

  StartLaunch: { VersionNumberError },

  CompleteLaunch: { DuplicatePackageNameError },

  SetRollbackBlock: { VersionNotFoundError },
};
