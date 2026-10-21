/**
 * Vetra Cloud (vetra.io) connection settings for the deploy commands.
 *
 * Constants and helpers live in `@powerhousedao/vetra-cloud-client` (shared with
 * vetra-app's Studio Deploy section). This file only resolves the CLI's
 * config-overridable endpoints on top of those defaults.
 */
import type { Config } from "../framework.js";
import {
  CLOUD_RENOWN_URL,
  cloudGraphqlEndpoint,
} from "@powerhousedao/vetra-cloud-client";

/** The Renown identity service for the login flow (config, else www.renown.id). */
export function resolveCloudConfig(config: Pick<Config, "cloudRenownUrl">): {
  renownUrl: string;
} {
  return { renownUrl: config.cloudRenownUrl ?? CLOUD_RENOWN_URL };
}

/**
 * The cloud switchboard's GraphQL endpoint. No default: an unset switchboard
 * must fail loudly rather than silently talk to staging (which rejected prod
 * studios' credentials with 401).
 */
export function resolveCloudGraphqlEndpoint(
  config: Pick<Config, "cloudSwitchboardUrl">,
): string {
  const url = config.cloudSwitchboardUrl?.trim();
  if (!url) {
    throw new Error(
      "No Vetra Cloud switchboard configured: set VETRA_CLOUD_SWITCHBOARD_URL (e.g. https://switchboard.vetra.io).",
    );
  }
  return cloudGraphqlEndpoint(url.replace(/\/$/, ""));
}

/**
 * The cloud's `vetra-apps` subgraph, addressed directly (`<base>/graphql/vetra-apps`).
 * The Studio agent's calls must go here rather than through the gateway at
 * `/graphql`: the gateway forwards only `authorization` to subgraphs, so the
 * Studio's `x-vetra-studio-secret` header would never arrive. Accepts a
 * configured URL with or without a trailing `/graphql`.
 */
export function resolveVetraAppsEndpoint(
  config: Pick<Config, "cloudSwitchboardUrl">,
): string {
  // `<base>/graphql` from the shared resolver (also throws when unset).
  const gateway = resolveCloudGraphqlEndpoint(config);
  const base = gateway.slice(0, -"/graphql".length).replace(/\/+$/, "").replace(/\/graphql$/, "");
  return `${base}/graphql/vetra-apps`;
}
