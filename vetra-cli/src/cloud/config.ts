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
  CLOUD_SWITCHBOARD_URL,
  cloudGraphqlEndpoint,
} from "./_cloud-client.js";

/** Resolve the cloud endpoints from config, defaulting to the shared constants. */
export function resolveCloudConfig(
  config: Pick<Config, "cloudSwitchboardUrl" | "cloudRenownUrl">,
): { switchboardUrl: string; renownUrl: string; graphqlEndpoint: string } {
  const switchboardUrl = config.cloudSwitchboardUrl ?? CLOUD_SWITCHBOARD_URL;
  const renownUrl = config.cloudRenownUrl ?? CLOUD_RENOWN_URL;
  return {
    switchboardUrl,
    renownUrl,
    graphqlEndpoint: cloudGraphqlEndpoint(switchboardUrl),
  };
}
