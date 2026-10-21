/**
 * X33: an existing Studio's product (adopted from before versions, spec §6.6)
 * gets Version 1 only on the customer's Make it live — the agent never
 * launches it by itself (vetra-cli `autoLaunchCandidate`), whether or not the
 * address it ran on before versions is known yet. Same rule as vetra-cli's
 * `adoptedWithoutVersions`.
 */
import type {
  Change,
  StudioProductState,
} from "document-models/studio-product";

export function adoptedWithoutVersions(product: StudioProductState): boolean {
  return (
    product.liveVersion === null &&
    product.versions.length === 0 &&
    product.changes.some((c) => c.kind === "BEFORE_VERSIONS")
  );
}

/** True when the build view shows the Ready bar with Make it live for `change`. */
export function showsFirstVersionBar(
  product: StudioProductState | null,
  change: Change | null,
): boolean {
  return (
    product !== null &&
    change !== null &&
    adoptedWithoutVersions(product) &&
    (change.status === "READY" || change.status === "LAUNCHING")
  );
}
