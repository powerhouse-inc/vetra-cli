import { applyCreateEnvironment } from "@powerhousedao/vetra-cloud-client";
import type { ISigner } from "document-model";
import { publishProject } from "../hooks/preview-server-client.js";
import {
  createNewEnvironmentController,
  loadEnvironmentController,
} from "./cloudController.js";

/** Where a deploy is headed: an existing environment (installing for the first
 * time or bumping its version) or a brand-new one created on the fly. */
export type DeployTarget =
  | { kind: "existing"; envId: string; alreadyInstalled: boolean }
  | { kind: "new"; label: string };

export type DeployPhase = "publishing" | "installing";

export type DeployOutcome = {
  packageName: string;
  version: string;
  /** false when no new version was published (source already up to date). */
  published: boolean;
  envId: string;
  url: string | null;
};

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
 * Deploy a project end to end:
 *  1. publish the package to the registry (server-side; skipped when the source
 *     is already the latest published version);
 *  2. install that exact version into the target environment (or create the
 *     environment first), then approve the change so the cloud deploys it.
 *
 * The push is signed by the user's Renown signer.
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
    throw new Error(pub.error);
  }
  const { packageName, version, published } = pub;

  onPhase?.("installing");

  if (target.kind === "new") {
    const ownerAddress = signer.user?.address;
    if (!ownerAddress) {
      throw new Error("Signer has no address — cannot create an environment.");
    }
    const controller = createNewEnvironmentController({
      parentIdentifier: driveId,
      signer,
    });
    applyCreateEnvironment(controller, {
      address: ownerAddress,
      label: target.label,
    });
    controller.addPackage({ packageName, version });
    controller.approveChanges({});
    const result = await controller.push();
    return {
      packageName,
      version,
      published,
      envId: result.remoteDocument.id,
      url: hostFromState(controller.state.global),
    };
  }

  const controller = await loadEnvironmentController({
    documentId: target.envId,
    parentIdentifier: driveId,
    signer,
  });
  if (target.alreadyInstalled) {
    controller.setPackageVersion({ packageName, version });
  } else {
    controller.addPackage({ packageName, version });
  }
  controller.approveChanges({});
  await controller.push();
  return {
    packageName,
    version,
    published,
    envId: target.envId,
    url: hostFromState(controller.state.global),
  };
}
