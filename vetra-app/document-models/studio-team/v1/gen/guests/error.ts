export type ErrorCode =
  "DuplicateGuestError" | "InvalidGuestExpiryError" | "GuestNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateGuestError extends Error implements ReducerError {
  errorCode = "DuplicateGuestError" as ErrorCode;
  constructor(message = "DuplicateGuestError") {
    super(message);
  }
}

export class InvalidGuestExpiryError extends Error implements ReducerError {
  errorCode = "InvalidGuestExpiryError" as ErrorCode;
  constructor(message = "InvalidGuestExpiryError") {
    super(message);
  }
}

export class GuestNotFoundError extends Error implements ReducerError {
  errorCode = "GuestNotFoundError" as ErrorCode;
  constructor(message = "GuestNotFoundError") {
    super(message);
  }
}

export const errors = {
  InviteGuest: { DuplicateGuestError, InvalidGuestExpiryError },

  RevokeGuest: { GuestNotFoundError },
};
