import { PHDocumentController, type ISigner } from "document-model";
import { RemoteDocumentController } from "@powerhousedao/reactor-browser";
import { VetraCloudEnvironmentV1 as VetraCloudEnvironment } from "@powerhousedao/vetra-cloud-package/document-models";
import type {
  VetraCloudEnvironmentAction,
  VetraCloudEnvironmentPHState,
} from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";
import { client } from "./cloudClient.js";

/**
 * A controller class bound to our installed document-model version. Built
 * locally (rather than importing the package's prebuilt class) to avoid
 * cross-compile-unit type mismatches. Mirrors vetra.to's controller.
 */
const VetraCloudEnvironmentController = PHDocumentController.forDocumentModel<
  VetraCloudEnvironmentPHState,
  VetraCloudEnvironmentAction
>(VetraCloudEnvironment);

export type EnvironmentController = Awaited<
  ReturnType<typeof loadEnvironmentController>
>;

/** Load an existing environment document and wrap it for signed pushes. */
export function loadEnvironmentController(options: {
  documentId: string;
  parentIdentifier: string;
  signer: ISigner;
}) {
  return RemoteDocumentController.pull(VetraCloudEnvironmentController, {
    client,
    documentId: options.documentId,
    mode: "batch",
    parentIdentifier: options.parentIdentifier,
    signer: options.signer,
    onConflict: "rebase",
  });
}

/** Create a controller for a new (not-yet-persisted) environment document. */
export function createNewEnvironmentController(options: {
  parentIdentifier: string;
  signer: ISigner;
}) {
  const inner = new VetraCloudEnvironmentController();
  return RemoteDocumentController.from(inner, {
    client,
    mode: "batch",
    parentIdentifier: options.parentIdentifier,
    signer: options.signer,
  });
}
