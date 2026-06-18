/**
 * Node write path for the deploy commands: a Renown-authenticated reactor
 * GraphQL client plus VetraCloudEnvironment controllers (load existing / create
 * new) for signed, pushable edits. Port of vetra-app's cloudClient.ts +
 * cloudController.ts for Node — no browser dependencies.
 */
import { PHDocumentController, type ISigner } from "document-model";
import {
  RemoteDocumentController,
  createClient,
  type ReactorGraphQLClient,
} from "@powerhousedao/reactor-browser";
import { VetraCloudEnvironmentV1 as VetraCloudEnvironment } from "@powerhousedao/vetra-cloud-package/document-models";
import type {
  VetraCloudEnvironmentAction,
  VetraCloudEnvironmentPHState,
} from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";
import { getBearerToken } from "../auth/renown.js";

/** Reactor GraphQL client that mints a fresh Renown bearer per request. No
 * `aud` claim (getBearerToken omits it) — the switchboard's verifier rejects
 * tokens that carry one. */
export function createCloudClient(
  workdir: string,
  renownUrl: string,
  graphqlEndpoint: string,
): ReactorGraphQLClient {
  const withAuth = async <T>(
    action: (headers?: Record<string, string>) => Promise<T>,
  ): Promise<T> => {
    const token = await getBearerToken(workdir, renownUrl);
    return token ? action({ authorization: `Bearer ${token}` }) : action();
  };
  return createClient(graphqlEndpoint, withAuth);
}

/** Controller class bound to our installed document-model version. Built
 * locally (rather than importing the package's prebuilt class) to avoid
 * cross-compile-unit type mismatches. Mirrors vetra-app's controller. */
const VetraCloudEnvironmentController = PHDocumentController.forDocumentModel<
  VetraCloudEnvironmentPHState,
  VetraCloudEnvironmentAction
>(VetraCloudEnvironment);

export type EnvironmentController = Awaited<
  ReturnType<typeof loadEnvironmentController>
>;

/** Load an existing environment document and wrap it for signed pushes. */
export function loadEnvironmentController(options: {
  client: ReactorGraphQLClient;
  documentId: string;
  parentIdentifier: string;
  signer: ISigner;
}) {
  return RemoteDocumentController.pull(VetraCloudEnvironmentController, {
    client: options.client,
    documentId: options.documentId,
    mode: "batch",
    parentIdentifier: options.parentIdentifier,
    signer: options.signer,
    onConflict: "rebase",
  });
}

/** Create a controller for a new (not-yet-persisted) environment document. */
export function createNewEnvironmentController(options: {
  client: ReactorGraphQLClient;
  parentIdentifier: string;
  signer: ISigner;
}) {
  const inner = new VetraCloudEnvironmentController();
  return RemoteDocumentController.from(inner, {
    client: options.client,
    mode: "batch",
    parentIdentifier: options.parentIdentifier,
    signer: options.signer,
  });
}
