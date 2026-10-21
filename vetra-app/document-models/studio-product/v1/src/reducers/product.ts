import type { StudioProductProductOperations } from "document-models/studio-product/v1";
import { ProductAlreadyInitializedError } from "../../gen/product/error.js";
import { normalizeProduct } from "../normalize.js";

export const studioProductProductOperations: StudioProductProductOperations = {
  initProductOperation(state, action) {
    normalizeProduct(state);
    if (state.createdAt !== null || state.idea !== null) {
      throw new ProductAlreadyInitializedError(
        "The product was already initialised.",
      );
    }
    state.name = action.input.name;
    state.idea = action.input.idea;
    state.createdAt = action.input.createdAt;
  },
  renameProductOperation(state, action) {
    normalizeProduct(state);
    state.name = action.input.name;
  },
  setAccessOperation(state, action) {
    normalizeProduct(state);
    state.access = action.input.access;
  },
};
