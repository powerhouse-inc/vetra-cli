export type ErrorCode =
  | "InvalidSuggestionCountError"
  | "InvalidSuggestionTextError"
  | "DuplicateSuggestionIdError"
  | "InvalidAfterVersionError"
  | "SuggestionNotFoundError"
  | "SuggestionNotOpenError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidSuggestionCountError extends Error implements ReducerError {
  errorCode = "InvalidSuggestionCountError" as ErrorCode;
  constructor(message = "InvalidSuggestionCountError") {
    super(message);
  }
}

export class InvalidSuggestionTextError extends Error implements ReducerError {
  errorCode = "InvalidSuggestionTextError" as ErrorCode;
  constructor(message = "InvalidSuggestionTextError") {
    super(message);
  }
}

export class DuplicateSuggestionIdError extends Error implements ReducerError {
  errorCode = "DuplicateSuggestionIdError" as ErrorCode;
  constructor(message = "DuplicateSuggestionIdError") {
    super(message);
  }
}

export class InvalidAfterVersionError extends Error implements ReducerError {
  errorCode = "InvalidAfterVersionError" as ErrorCode;
  constructor(message = "InvalidAfterVersionError") {
    super(message);
  }
}

export class SuggestionNotFoundError extends Error implements ReducerError {
  errorCode = "SuggestionNotFoundError" as ErrorCode;
  constructor(message = "SuggestionNotFoundError") {
    super(message);
  }
}

export class SuggestionNotOpenError extends Error implements ReducerError {
  errorCode = "SuggestionNotOpenError" as ErrorCode;
  constructor(message = "SuggestionNotOpenError") {
    super(message);
  }
}

export const errors = {
  SetSuggestions: {
    InvalidSuggestionCountError,
    InvalidSuggestionTextError,
    DuplicateSuggestionIdError,
    InvalidAfterVersionError,
  },

  UseSuggestion: { SuggestionNotFoundError, SuggestionNotOpenError },
};
