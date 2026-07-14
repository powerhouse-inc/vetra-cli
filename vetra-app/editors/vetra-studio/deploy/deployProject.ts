import {
  applyCreateEnvironment,
  DEPLOY_SERVICES,
  ensureServicesEnabled,
  isStudioEnvironment,
} from "@powerhousedao/vetra-cloud-client";
import type { ISigner } from "document-model";
import {
  fetchVersion,
  publishProject,
} from "../hooks/preview-server-client.js";
import {
  createNewEnvironmentController,
  loadEnvironmentController,
  type EnvironmentController,
} from "./cloudController.js";
import { canApprove, isPendingApproval } from "./envStatus.js";
import { isAuthError } from "./utils.js";

/** Where a deploy is headed: an existing environment (installing for the first
 * time or bumping its version) or a brand-new one created on the fly. */
export type DeployTarget =
  | { kind: "existing"; envId: string; alreadyInstalled: boolean }
  | { kind: "new"; label: string };

export type DeployPhase = "publishing" | "installing" | "approving";

export type DeployOutcome = {
  packageName: string;
  version: string;
  /** false when no new version was published (source already up to date). */
  published: boolean;
  envId: string;
  url: string | null;
  /** Authoritative environment status after the signed push (push re-pulls
   * server state). `CHANGES_PENDING` here means the approve did not land and
   * the change won't go live until it's approved. */
  status: string;
};

/** Why a deploy failed, so the UI can respond (re-auth vs. plain error).
 * `auth-required` = the agent can't publish (needs agent authorization);
 * `session-expired` = the cloud rejected the user's Renown session on the
 * signed push (needs a user re-login). */
export type DeployErrorKind =
  | "auth-required"
  | "session-expired"
  | "no-package"
  | "unknown-project"
  | "publish-failed";

/** Error carrying a machine-readable `kind` for deploy failures. */
export class DeployError extends Error {
  constructor(
    readonly kind: DeployErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

type PushResult = Awaited<ReturnType<EnvironmentController["push"]>>;

function hostFromState(global: {
  genericSubdomain?: string | null;
  genericBaseDomain?: string | null;
}): string | null {
  const { genericSubdomain, genericBaseDomain } = global;
  if (genericSubdomain && genericBaseDomain) {
    return `${genericSubdomain}.${genericBaseDomain}`;
  }
  return genericSubdomain ?? null;
}

/**
 * Push the controller's staged edits and approve them so the cloud rolls them
 * out. `push()` sends the accumulated actions then pulls the latest server
 * state, so `controller.state.global.status` afterwards is authoritative. If
 * the approve was dropped (a rebase against concurrent edits, or a server-side
 * rejection) the env stays `CHANGES_PENDING`; retry the approve once against
 * the fresh state. Returns the final status and the last push result (whose
 * `remoteDocument.id` identifies a newly-created environment).
 */
async function commitAndApprove(
  controller: EnvironmentController,
): Promise<{ status: string; push: PushResult }> {
  if (canApprove(controller.state.global.status)) {
    controller.approveChanges({});
  }
  let push = await controller.push();
  let status = controller.state.global.status;
  if (isPendingApproval(status)) {
    controller.approveChanges({});
    push = await controller.push();
    status = controller.state.global.status;
  }
  return { status, push };
}

/**
 * Deploy a project end to end:
 *  1. publish the package to the registry (server-side; skipped when the source
 *     is already the latest published version);
 *  2. install that exact version into the target environment (or create the
 *     environment first), then approve the change so the cloud deploys it.
 *
 * The push is signed by the user's Renown signer. The returned `status` is the
 * authoritative post-push environment status.
 */
export async function deployProject(opts: {
  project: string;
  driveId: string;
  signer: ISigner;
  target: DeployTarget;
  onPhase?: (phase: DeployPhase) => void;
}): Promise<DeployOutcome> {
  const { project, driveId, signer, target, onPhase } = opts;

  onPhase?.("publishing");
  const pub = await publishProject({ project });
  if (pub.kind !== "ok") {
    const kind: DeployErrorKind =
      pub.kind === "auth-required"
        ? "auth-required"
        : pub.kind === "no-package"
          ? "no-package"
          : pub.kind === "unknown-project"
            ? "unknown-project"
            : "publish-failed";
    throw new DeployError(kind, pub.error);
  }
  const { packageName, version, published } = pub;

  onPhase?.("installing");

  // The cloud pull/push authorizes with the user's Renown session; surface a
  // rejected session as a typed error so the UI can offer a re-login instead
  // of dumping the transport error.
  try {
    if (target.kind === "new") {
      const ownerAddress = signer.user?.address;
      if (!ownerAddress) {
        throw new Error(
          "Signer has no address — cannot create an environment.",
        );
      }
      // Pin the new env's services to the stack version the Studio runs so the
      // deployment can't drift into API differences. A transient /version outage
      // leaves it unpinned rather than blocking the deploy.
      const frameworkVersion = await fetchVersion().catch(() => null);
      const controller = createNewEnvironmentController({
        parentIdentifier: driveId,
        signer,
      });
      applyCreateEnvironment(controller, {
        address: ownerAddress,
        label: target.label,
        services: DEPLOY_SERVICES,
        serviceVersion: frameworkVersion?.ph,
      });
      controller.addPackage({ packageName, version });
      onPhase?.("approving");
      const { status, push } = await commitAndApprove(controller);
      return {
        packageName,
        version,
        published,
        envId: push.remoteDocument.id,
        url: hostFromState(controller.state.global),
        status,
      };
    }

    const controller = await loadEnvironmentController({
      documentId: target.envId,
      parentIdentifier: driveId,
      signer,
    });
    if (
      isStudioEnvironment(controller.state.global.packages.map((p) => p.name))
    ) {
      throw new Error(
        "Cannot deploy to this environment: it is reserved for Vetra Studio itself. " +
          "Please choose a different environment or create a new one for your project's deployment.",
      );
    }
    if (target.alreadyInstalled) {
      controller.setPackageVersion({ packageName, version });
    } else {
      controller.addPackage({ packageName, version });
    }
    ensureServicesEnabled(controller, DEPLOY_SERVICES);
    onPhase?.("approving");
    const { status } = await commitAndApprove(controller);
    return {
      packageName,
      version,
      published,
      envId: target.envId,
      url: hostFromState(controller.state.global),
      status,
    };
  } catch (err) {
    if (isAuthError(err)) {
      throw new DeployError(
        "session-expired",
        "The cloud rejected your Renown session.",
      );
    }
    throw err;
  }
}
