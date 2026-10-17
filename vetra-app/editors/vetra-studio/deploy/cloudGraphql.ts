import {
  fetchMyEnvironments as fetchEnvironments,
  type EnvironmentSummary,
  type ListScope,
} from "@powerhousedao/vetra-cloud-client";
import { resolveCloudGraphqlEndpoint } from "./cloudClient.js";

export type { EnvironmentSummary, ListScope };

/** List the caller's own environments against the cloud switchboard. `scope` is
 * enforced server-side. */
export async function fetchMyEnvironments(
  scope: ListScope,
  token?: string | null,
): Promise<EnvironmentSummary[]> {
  return fetchEnvironments(await resolveCloudGraphqlEndpoint(), scope, token);
}
