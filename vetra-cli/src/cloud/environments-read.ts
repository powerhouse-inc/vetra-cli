/**
 * Read-side environment access for the deploy commands: resolve a bearer token
 * from the workdir's Renown identity, query the cloud switchboard via the shared
 * client, and trim the result to the caller's own environments.
 */
import type { Config } from "../framework.js";
import {
  fetchMyEnvironments,
  filterOwn,
  type EnvironmentSummary,
  type ListScope,
} from "@powerhousedao/vetra-cloud-client";
import { getBearerToken, getRenownStatus } from "../auth/renown.js";
import { resolveCloudConfig } from "./config.js";

export interface ReadContext {
  workdir: string;
  config: Config;
}

export const NOT_AUTHENTICATED =
  "Not authorized — you can't act as the user until they connect their Renown " +
  "identity to you. Ask the user to click 'Authorize agent' in the top bar of " +
  "Vetra Studio (next to Auto-follow agent) and approve in their wallet, then " +
  "retry. There is no sign-in tool — do not run a terminal command or try to " +
  "authorize yourself (use whoami to check authorization).";

/** Fetch the user's environments from the cloud switchboard. `ALL` skips the
 * owner filter; `MINE` applies it. Throws an actionable error when not signed in. */
export async function listMyEnvironments(
  ctx: ReadContext,
  scope: ListScope = "MINE",
): Promise<EnvironmentSummary[]> {
  const { renownUrl, graphqlEndpoint } = resolveCloudConfig(ctx.config);
  const token = await getBearerToken(ctx.workdir, renownUrl);
  if (!token) throw new Error(NOT_AUTHENTICATED);
  const items = await fetchMyEnvironments(graphqlEndpoint, scope, token);
  if (scope === "ALL") return items;
  const status = await getRenownStatus(ctx.workdir, renownUrl);
  return filterOwn(items, status.address);
}

/** Resolve a single environment by id, name, or subdomain (MINE scope). */
export async function findMyEnvironment(
  ctx: ReadContext,
  query: string,
): Promise<EnvironmentSummary | undefined> {
  const q = query.trim();
  const lower = q.toLowerCase();
  const items = await listMyEnvironments(ctx, "MINE");
  return items.find(
    (e) =>
      e.id === q ||
      e.subdomain === q ||
      e.name === q ||
      e.name?.toLowerCase() === lower,
  );
}
