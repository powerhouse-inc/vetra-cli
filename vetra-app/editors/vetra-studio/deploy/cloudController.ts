import type { ISigner } from "document-model";
import {
  createNewEnvironmentController as createNew,
  loadEnvironmentController as load,
  type EnvironmentController,
} from "@powerhousedao/vetra-cloud-client";
import { client } from "./cloudClient.js";

export type { EnvironmentController };

/** Load an existing environment document and wrap it for signed pushes, bound
 * to the Studio's cloud reactor client. */
export function loadEnvironmentController(options: {
  documentId: string;
  parentIdentifier: string;
  signer: ISigner;
}): Promise<EnvironmentController> {
  return load({ client, ...options });
}

/** Create a controller for a new (not-yet-persisted) environment document. */
export function createNewEnvironmentController(options: {
  parentIdentifier: string;
  signer: ISigner;
}): EnvironmentController {
  return createNew({ client, ...options });
}
