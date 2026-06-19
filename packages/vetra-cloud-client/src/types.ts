import type {
  VetraCloudEnvironmentAction,
  VetraCloudEnvironmentGlobalState,
  VetraCloudEnvironmentPHState,
} from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";

export type {
  VetraCloudEnvironmentAction,
  VetraCloudEnvironmentGlobalState,
  VetraCloudEnvironmentPHState,
};

/** Caller-scoped environment summary from the observability subgraph's
 * `myEnvironments` query. The server enforces the scope, so we only receive the
 * caller's own environments. */
export type EnvironmentSummary = {
  id: string;
  name: string | null;
  subdomain: string | null;
  customDomain: string | null;
  status: string | null;
  owner: string | null;
  /** Legacy creator column — keeps a just-created env (before SET_OWNER lands)
   * in the creator's MINE view. */
  createdBy: string | null;
};

export type ListScope = "MINE" | "ALL";

/** Services the user can toggle on an environment. CLINT is excluded — it needs
 * a package + env-var config beyond a simple toggle. */
export type CloudServiceType = "CONNECT" | "SWITCHBOARD" | "FUSION";

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

/** Mints a bearer token for cloud requests, or null when not signed in. No
 * `aud` claim — the switchboard's verifier rejects tokens that carry one. */
export type TokenProvider = () => Promise<string | null>;
