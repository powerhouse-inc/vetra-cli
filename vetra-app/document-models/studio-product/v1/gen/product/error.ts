export type ErrorCode = "ProductAlreadyInitializedError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class ProductAlreadyInitializedError
  extends Error
  implements ReducerError
{
  errorCode = "ProductAlreadyInitializedError" as ErrorCode;
  constructor(message = "ProductAlreadyInitializedError") {
    super(message);
  }
}

export const errors = {
  InitProduct: { ProductAlreadyInitializedError },
};
