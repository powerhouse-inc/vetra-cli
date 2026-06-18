/**
 * Write-side environment operations for the deploy commands: resolve the
 * workdir's Renown signer, load (or create) a VetraCloudEnvironment document,
 * apply signed actions, and push them to the cloud switchboard. Mirrors
 * vetra-app's EnvironmentDetail / CreateEnvironmentForm mutation flow for Node.
 */
import { randomUUID } from "node:crypto";
import type { ISigner } from "document-model";
import type { VetraCloudEnvironmentGlobalState } from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";
import { getRenown } from "../auth/renown.js";
import {
  CLOUD_BASE_DOMAIN,
  CLOUD_DEFAULT_PACKAGE_REGISTRY,
  SERVICE_PREFIXES,
  resolveCloudConfig,
  resolveCloudDriveId,
  type CloudServiceType,
} from "./config.js";
import { NOT_AUTHENTICATED, type ReadContext } from "./environments-read.js";
import {
  createCloudClient,
  createNewEnvironmentController,
  loadEnvironmentController,
  type EnvironmentController,
} from "./controller.js";
import { generateSubdomain } from "./subdomain.js";

/** Status transitions an update can drive. The model exposes only these two
 * explicit transitions (no generic setStatus), matching the studio's
 * Approve/Terminate actions. */
export type EnvironmentTransition = "CHANGES_APPROVED" | "TERMINATING";

export interface EnvironmentChanges {
  label?: string;
  transition?: EnvironmentTransition;
  enableServices?: CloudServiceType[];
  disableServices?: CloudServiceType[];
  addPackages?: { name: string; version?: string }[];
  removePackages?: string[];
}

interface WriteSession {
  signer: ISigner;
  address: string;
  driveId: string;
  client: ReturnType<typeof createCloudClient>;
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
    client: createCloudClient(ctx.workdir, renownUrl, graphqlEndpoint),
  };
}

function prefixFor(
  controller: EnvironmentController,
  type: CloudServiceType,
): string {
  const existing = controller.state.global.services.find((s) => s.type === type);
  return existing?.prefix || SERVICE_PREFIXES[type];
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

  if (changes.label) controller.setLabel({ label: changes.label });
  for (const type of changes.enableServices ?? []) {
    controller.enableService({ type, prefix: prefixFor(controller, type) });
  }
  for (const type of changes.disableServices ?? []) {
    controller.disableService({ type });
  }
  for (const pkg of changes.addPackages ?? []) {
    controller.addPackage({ packageName: pkg.name, version: pkg.version });
  }
  for (const packageName of changes.removePackages ?? []) {
    controller.removePackage({ packageName });
  }
  // Status transition last — terminate/approve closes out the edit set.
  if (changes.transition === "CHANGES_APPROVED") controller.approveChanges({});
  else if (changes.transition === "TERMINATING") {
    controller.terminateEnvironment({});
  }

  await controller.push();
  return controller.state.global;
}

/** Create a new environment (DRAFT → CHANGES_APPROVED after initialize),
 * claiming ownership for the signed-in user. Returns its new document id and
 * resulting state. */
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

  // setOwner first — every subsequent action is owner-gated on the remote.
  controller.setOwner({ address: session.address });
  controller.setLabel({ label: options.label });
  controller.initialize({
    genericSubdomain: generateSubdomain(randomUUID()),
    genericBaseDomain: CLOUD_BASE_DOMAIN,
    defaultPackageRegistry: CLOUD_DEFAULT_PACKAGE_REGISTRY,
  });
  const services = options.services?.length ? options.services : ["CONNECT"];
  for (const type of services as CloudServiceType[]) {
    controller.enableService({ type, prefix: SERVICE_PREFIXES[type] });
  }

  const result = await controller.push();
  return { id: result.remoteDocument.id, state: controller.state.global };
}
