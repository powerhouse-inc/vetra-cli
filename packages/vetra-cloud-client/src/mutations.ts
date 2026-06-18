import {
  CLOUD_BASE_DOMAIN,
  CLOUD_DEFAULT_PACKAGE_REGISTRY,
  SERVICE_PREFIXES,
} from "./config.js";
import type { EnvironmentController } from "./controller.js";
import { generateSubdomain } from "./subdomain.js";
import type { CloudServiceType, EnvironmentChanges } from "./types.js";

/** Prefix to re-enable a service with: its current prefix if previously set,
 * else the default. */
function prefixFor(
  controller: EnvironmentController,
  type: CloudServiceType,
): string {
  const existing = controller.state.global.services.find((s) => s.type === type);
  return existing?.prefix || SERVICE_PREFIXES[type];
}

/** Apply edits to a loaded environment controller. Does not push — the caller
 * pushes once after. Status transition is applied last so terminate/approve
 * closes out the edit set. */
export function applyEnvironmentUpdate(
  controller: EnvironmentController,
  changes: EnvironmentChanges,
): void {
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
  if (changes.transition === "CHANGES_APPROVED") controller.approveChanges({});
  else if (changes.transition === "TERMINATING") {
    controller.terminateEnvironment({});
  }
}

/** Apply the create sequence to a new environment controller. Does not push.
 * setOwner first — every subsequent action is owner-gated on the remote. */
export function applyCreateEnvironment(
  controller: EnvironmentController,
  options: {
    address: string;
    label: string;
    services?: CloudServiceType[];
    baseDomain?: string;
    defaultPackageRegistry?: string;
  },
): void {
  controller.setOwner({ address: options.address });
  controller.setLabel({ label: options.label });
  controller.initialize({
    genericSubdomain: generateSubdomain(globalThis.crypto.randomUUID()),
    genericBaseDomain: options.baseDomain ?? CLOUD_BASE_DOMAIN,
    defaultPackageRegistry:
      options.defaultPackageRegistry ?? CLOUD_DEFAULT_PACKAGE_REGISTRY,
  });
  const services: CloudServiceType[] = options.services?.length
    ? options.services
    : ["CONNECT"];
  for (const type of services) {
    controller.enableService({ type, prefix: SERVICE_PREFIXES[type] });
  }
}
