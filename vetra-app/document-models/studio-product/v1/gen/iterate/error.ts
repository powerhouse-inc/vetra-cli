export type ErrorCode =
  | "InvalidReviewCountError"
  | "InvalidReviewTextError"
  | "DuplicateReviewIdError"
  | "UnknownVersionError"
  | "VariantChangeNotFoundError"
  | "VariantsExistError"
  | "ChangeNotOpenError"
  | "VariantNotFoundError"
  | "InvalidVariantTransitionError"
  | "VariantNotReadyError"
  | "InvalidOriginError"
  | "OriginNotFoundError"
  | "InvalidPublicSourceError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidReviewCountError extends Error implements ReducerError {
  errorCode = "InvalidReviewCountError" as ErrorCode;
  constructor(message = "InvalidReviewCountError") {
    super(message);
  }
}

export class InvalidReviewTextError extends Error implements ReducerError {
  errorCode = "InvalidReviewTextError" as ErrorCode;
  constructor(message = "InvalidReviewTextError") {
    super(message);
  }
}

export class DuplicateReviewIdError extends Error implements ReducerError {
  errorCode = "DuplicateReviewIdError" as ErrorCode;
  constructor(message = "DuplicateReviewIdError") {
    super(message);
  }
}

export class UnknownVersionError extends Error implements ReducerError {
  errorCode = "UnknownVersionError" as ErrorCode;
  constructor(message = "UnknownVersionError") {
    super(message);
  }
}

export class VariantChangeNotFoundError extends Error implements ReducerError {
  errorCode = "VariantChangeNotFoundError" as ErrorCode;
  constructor(message = "VariantChangeNotFoundError") {
    super(message);
  }
}

export class VariantsExistError extends Error implements ReducerError {
  errorCode = "VariantsExistError" as ErrorCode;
  constructor(message = "VariantsExistError") {
    super(message);
  }
}

export class ChangeNotOpenError extends Error implements ReducerError {
  errorCode = "ChangeNotOpenError" as ErrorCode;
  constructor(message = "ChangeNotOpenError") {
    super(message);
  }
}

export class VariantNotFoundError extends Error implements ReducerError {
  errorCode = "VariantNotFoundError" as ErrorCode;
  constructor(message = "VariantNotFoundError") {
    super(message);
  }
}

export class InvalidVariantTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidVariantTransitionError" as ErrorCode;
  constructor(message = "InvalidVariantTransitionError") {
    super(message);
  }
}

export class VariantNotReadyError extends Error implements ReducerError {
  errorCode = "VariantNotReadyError" as ErrorCode;
  constructor(message = "VariantNotReadyError") {
    super(message);
  }
}

export class InvalidOriginError extends Error implements ReducerError {
  errorCode = "InvalidOriginError" as ErrorCode;
  constructor(message = "InvalidOriginError") {
    super(message);
  }
}

export class OriginNotFoundError extends Error implements ReducerError {
  errorCode = "OriginNotFoundError" as ErrorCode;
  constructor(message = "OriginNotFoundError") {
    super(message);
  }
}

export class InvalidPublicSourceError extends Error implements ReducerError {
  errorCode = "InvalidPublicSourceError" as ErrorCode;
  constructor(message = "InvalidPublicSourceError") {
    super(message);
  }
}

export const errors = {
  SetReviewSuggestions: {
    InvalidReviewCountError,
    InvalidReviewTextError,
    DuplicateReviewIdError,
    UnknownVersionError,
  },

  StartVariants: {
    VariantChangeNotFoundError,
    VariantsExistError,
    ChangeNotOpenError,
  },

  SetVariantStatus: {
    VariantChangeNotFoundError,
    VariantNotFoundError,
    InvalidVariantTransitionError,
  },

  KeepVariant: {
    VariantChangeNotFoundError,
    VariantNotFoundError,
    VariantNotReadyError,
  },

  SetOrigin: { InvalidOriginError },

  SetUpstreamVersion: { OriginNotFoundError },

  SetPublicSource: { InvalidPublicSourceError },
};
