export type ErrorCode =
  | "InvalidUnderstoodError"
  | "InvalidLanguageError"
  | "InvalidGuidedLoopTransitionError"
  | "QuestionChangeNotFoundError"
  | "DuplicateQuestionIdError"
  | "InvalidQuestionError"
  | "QuestionNotFoundError"
  | "QuestionAlreadyAnsweredError"
  | "CostChangeNotFoundError"
  | "InvalidCostError"
  | "DuplicateRowImportError"
  | "RowImportNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidUnderstoodError extends Error implements ReducerError {
  errorCode = "InvalidUnderstoodError" as ErrorCode;
  constructor(message = "InvalidUnderstoodError") {
    super(message);
  }
}

export class InvalidLanguageError extends Error implements ReducerError {
  errorCode = "InvalidLanguageError" as ErrorCode;
  constructor(message = "InvalidLanguageError") {
    super(message);
  }
}

export class InvalidGuidedLoopTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidGuidedLoopTransitionError" as ErrorCode;
  constructor(message = "InvalidGuidedLoopTransitionError") {
    super(message);
  }
}

export class QuestionChangeNotFoundError extends Error implements ReducerError {
  errorCode = "QuestionChangeNotFoundError" as ErrorCode;
  constructor(message = "QuestionChangeNotFoundError") {
    super(message);
  }
}

export class DuplicateQuestionIdError extends Error implements ReducerError {
  errorCode = "DuplicateQuestionIdError" as ErrorCode;
  constructor(message = "DuplicateQuestionIdError") {
    super(message);
  }
}

export class InvalidQuestionError extends Error implements ReducerError {
  errorCode = "InvalidQuestionError" as ErrorCode;
  constructor(message = "InvalidQuestionError") {
    super(message);
  }
}

export class QuestionNotFoundError extends Error implements ReducerError {
  errorCode = "QuestionNotFoundError" as ErrorCode;
  constructor(message = "QuestionNotFoundError") {
    super(message);
  }
}

export class QuestionAlreadyAnsweredError
  extends Error
  implements ReducerError
{
  errorCode = "QuestionAlreadyAnsweredError" as ErrorCode;
  constructor(message = "QuestionAlreadyAnsweredError") {
    super(message);
  }
}

export class CostChangeNotFoundError extends Error implements ReducerError {
  errorCode = "CostChangeNotFoundError" as ErrorCode;
  constructor(message = "CostChangeNotFoundError") {
    super(message);
  }
}

export class InvalidCostError extends Error implements ReducerError {
  errorCode = "InvalidCostError" as ErrorCode;
  constructor(message = "InvalidCostError") {
    super(message);
  }
}

export class DuplicateRowImportError extends Error implements ReducerError {
  errorCode = "DuplicateRowImportError" as ErrorCode;
  constructor(message = "DuplicateRowImportError") {
    super(message);
  }
}

export class RowImportNotFoundError extends Error implements ReducerError {
  errorCode = "RowImportNotFoundError" as ErrorCode;
  constructor(message = "RowImportNotFoundError") {
    super(message);
  }
}

export const errors = {
  SetUnderstood: { InvalidUnderstoodError, InvalidLanguageError },

  SetGuidedLoop: { InvalidGuidedLoopTransitionError },

  AskQuestion: {
    QuestionChangeNotFoundError,
    DuplicateQuestionIdError,
    InvalidQuestionError,
  },

  AnswerQuestion: { QuestionNotFoundError, QuestionAlreadyAnsweredError },

  SetChangeCost: { CostChangeNotFoundError, InvalidCostError },

  StartRowImport: { DuplicateRowImportError },

  FinishRowImport: { RowImportNotFoundError },
};
