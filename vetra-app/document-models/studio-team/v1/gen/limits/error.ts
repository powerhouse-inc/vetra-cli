export type ErrorCode = "InvalidLimitError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidLimitError extends Error implements ReducerError {
  errorCode = "InvalidLimitError" as ErrorCode;
  constructor(message = "InvalidLimitError") {
    super(message);
  }
}

export const errors = {
  SetMemberLimit: { InvalidLimitError },
};
