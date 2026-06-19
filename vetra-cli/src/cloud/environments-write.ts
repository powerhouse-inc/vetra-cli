/**
 * Write-side environment operations for the deploy commands: resolve the
 * workdir's Renown signer + an authenticated reactor client, then delegate the
 * load/create + signed action sequences to `@powerhousedao/vetra-cloud-client`
 * and push.
 */
import type { ISigner } from "document-model";
import {
  applyCreateEnvironment,
  applyEnvironmentUpdate as applyUpdateActions,
  createNewEnvironmentController,
  createReactorClient,
  loadEnvironmentController,
  resolveCloudDriveId,
  type CloudServiceType,
  type EnvironmentChanges,
  type VetraCloudEnvironmentGlobalState,
} from "./_cloud-client.js";
import { getBearerToken, getRenown } from "../auth/renown.js";
import { resolveCloudConfig } from "./config.js";
import { NOT_AUTHENTICATED, type ReadContext } from "./environments-read.js";

export type { EnvironmentChanges, EnvironmentTransition } from "./_cloud-client.js";

interface WriteSession {
  signer: ISigner;
  address: string;
  driveId: string;
  client: ReturnType<typeof createReactorClient>;
}

/** Resolve the signer, drive, and authenticated reactor client for a write.
 * Throws the actionable not-authorized error when the agent isn't signed in. */
async function getWriteSession(ctx: ReadContext): Promise<WriteSession> {
  const { renownUrl, graphqlEndpoint } = resolveCloudConfig(ctx.config);
  const renown = await getRenown(ctx.workdir, renownUrl);
  if (!renown.user) throw new Error(NOT_AUTHENTICATED);
  return {
    signer: renown.signer,
    address: renown.user.address,
    driveId: resolveCloudDriveId(renown.user.address),
    client: createReactorClient(graphqlEndpoint, () =>
      getBearerToken(ctx.workdir, renownUrl),
    ),
  };
}

/** Apply edits to an existing environment and push them. `documentId` is the
 * environment id from the read path (deploy-environment-list). Returns the
 * resulting global state. */
export async function applyEnvironmentUpdate(
  ctx: ReadContext,
  documentId: string,
  changes: EnvironmentChanges,
): Promise<VetraCloudEnvironmentGlobalState> {
  const session = await getWriteSession(ctx);
  const controller = await loadEnvironmentController({
    client: session.client,
    documentId,
    parentIdentifier: session.driveId,
    signer: session.signer,
  });
  applyUpdateActions(controller, changes);
  await controller.push();
  return controller.state.global;
}

/** Create a new environment, claiming ownership for the signed-in user. Returns
 * its new document id and resulting state. */
export async function createCloudEnvironment(
  ctx: ReadContext,
  options: { label: string; services?: CloudServiceType[] },
): Promise<{ id: string; state: VetraCloudEnvironmentGlobalState }> {
  const session = await getWriteSession(ctx);
  const controller = createNewEnvironmentController({
    client: session.client,
    parentIdentifier: session.driveId,
    signer: session.signer,
  });
  applyCreateEnvironment(controller, {
    address: session.address,
    label: options.label,
    services: options.services,
  });
  const result = await controller.push();
  return { id: result.remoteDocument.id, state: controller.state.global };
}
