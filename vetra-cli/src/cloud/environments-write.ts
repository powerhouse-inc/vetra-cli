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
  DEPLOY_SERVICES,
  ensureServicesEnabled,
  isStudioEnvironment,
  loadEnvironmentController,
  resolveCloudDriveId,
  type CloudServiceType,
  type EnvironmentChanges,
  type EnvironmentSummary,
  type ListScope,
  type VetraCloudEnvironmentGlobalState,
} from "@powerhousedao/vetra-cloud-client";
import { resolveRegistryUrl } from "@powerhousedao/shared/registry";
import { getBearerToken, getRenown } from "../auth/renown.js";
import { DEFAULT_PH_VERSION } from "../constants.js";
import { resolveCloudConfig } from "./config.js";
import {
  listMyEnvironments,
  NOT_AUTHENTICATED,
  type ReadContext,
} from "./environments-read.js";
import { stampStudioInstance } from "./stamp-studio-instance.js";

export type {
  EnvironmentChanges,
  EnvironmentTransition,
} from "@powerhousedao/vetra-cloud-client";

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

/** Load an environment's full document state (services, installed packages +
 * versions, registry) without modifying it. The read path's `myEnvironments`
 * summary lacks these, so reads that need package/service detail pull the
 * document here. Requires the agent to be authorized (signer). */
export async function loadEnvironmentState(
  ctx: ReadContext,
  documentId: string,
): Promise<VetraCloudEnvironmentGlobalState> {
  const session = await getWriteSession(ctx);
  const controller = await loadEnvironmentController({
    client: session.client,
    documentId,
    parentIdentifier: session.driveId,
    signer: session.signer,
  });
  return controller.state.global;
}

export type EnvironmentSummaryWithStudio = EnvironmentSummary & {
  /** This env runs Vetra Studio (has `vetra-cli` installed) — not a deploy
   * target. */
  isStudio: boolean;
};

/** List the caller's environments and flag the Vetra Studio ones. The summary
 * query carries no packages, so each env's document is loaded to read its
 * installed packages; a load failure leaves the env unflagged (the write path
 * refuses package installs as the hard backstop, so a transient error can't let
 * a deploy through). */
export async function listEnvironmentsWithStudioFlag(
  ctx: ReadContext,
  scope: ListScope = "MINE",
): Promise<EnvironmentSummaryWithStudio[]> {
  const items = await listMyEnvironments(ctx, scope);
  return Promise.all(
    items.map(async (env) => {
      const state = await loadEnvironmentState(ctx, env.id).catch(() => null);
      const isStudio = state
        ? isStudioEnvironment(state.packages.map((p) => p.name))
        : false;
      return { ...env, isStudio };
    }),
  );
}

/** Apply edits to an existing environment and push them. `documentId` is the
 * environment id from the read path (deploy-environment-list). Returns the
 * resulting global state. Refuses to install packages into a Vetra Studio
 * environment — those host the Studio itself. */
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
  if (
    (changes.addPackages?.length ?? 0) > 0 &&
    isStudioEnvironment(controller.state.global.packages.map((p) => p.name))
  ) {
    const label = controller.state.global.label ?? documentId;
    throw new Error(
      `Cannot install packages into the Vetra Studio environment "${label}".
This environment runs Vetra Studio and cannot be used as a deploy target.
Please select a different environment or create a new one for deployments.`,
    );
  }
  // Installing an app implies it must be reachable: Connect serves the UI,
  // Switchboard the reactor/GraphQL backend. Force both on (idempotent) so a
  // package-only update never lands a deploy that can't actually run.
  if ((changes.addPackages?.length ?? 0) > 0) {
    ensureServicesEnabled(controller, DEPLOY_SERVICES);
    // Link the target env to the studio that produced it (this agent's own
    // env). "Where the package from the studio is installed" — stamped only on
    // a package install, only when running inside a studio (environmentId set),
    // and only when it isn't already linked to this studio.
    stampStudioInstance(controller, ctx.config);
  }
  applyUpdateActions(controller, changes);
  await controller.push();
  return controller.state.global;
}

/** Create a new environment owned by the signed-in user. Services pin to
 * `version ?? config.phVersion ?? DEFAULT_PH_VERSION` (reactor-project-init's precedence). */
export async function createCloudEnvironment(
  ctx: ReadContext,
  options: { label: string; services?: CloudServiceType[]; version?: string },
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
    serviceVersion: options.version ?? ctx.config.phVersion ?? DEFAULT_PH_VERSION,
    // Stamp the same registry the workdir publishes to (flag > PH_REGISTRY_URL
    // > powerhouse.config.json > default) so the env installs from where we push.
    defaultPackageRegistry: resolveRegistryUrl({
      registry: ctx.config.registryUrl,
      projectPath: ctx.workdir,
    }),
  });
  // A studio-created deploy target belongs to this studio — link it so it
  // groups under the studio on /user/products (no-op outside a studio context).
  stampStudioInstance(controller, ctx.config);
  const result = await controller.push();
  return { id: result.remoteDocument.id, state: controller.state.global };
}
