import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The package registry to publish to / stamp onto environments: the explicit
 * flag/config, then PH_REGISTRY_URL, then the project's powerhouse.config.json.
 *
 * Unlike `@powerhousedao/shared/registry`'s resolver there is NO default: a
 * missing registry must fail loudly instead of silently using the dev
 * registry (which put prod studios' packages on registry.dev.vetra.io).
 */
export function resolveRegistryUrl(options: {
  registry?: string | null;
  projectPath: string;
  env?: Record<string, string | undefined>;
}): string {
  const url = findRegistryUrl(options);
  if (!url) {
    throw new Error(
      "No package registry configured: pass --registry, set PH_REGISTRY_URL, or set packageRegistryUrl in powerhouse.config.json.",
    );
  }
  return url;
}

/** Same lookup without throwing; null when nothing is configured. */
export function findRegistryUrl(options: {
  registry?: string | null;
  projectPath: string;
  env?: Record<string, string | undefined>;
}): string | null {
  const env = options.env ?? process.env;
  const explicit = options.registry?.trim() || env.PH_REGISTRY_URL?.trim();
  if (explicit) return explicit;
  const file = path.join(options.projectPath, "powerhouse.config.json");
  if (!existsSync(file)) return null;
  try {
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      packageRegistryUrl?: unknown;
    };
    return typeof config.packageRegistryUrl === "string" &&
      config.packageRegistryUrl.trim()
      ? config.packageRegistryUrl.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Ruling R25: the registry of a Studio's own stack, keyed by the cloud
 * switchboard's host. Older prod Studios run without PH_REGISTRY_URL; their
 * launches publish here instead of failing.
 */
export const STACK_REGISTRIES: Readonly<Record<string, string>> = {
  "switchboard.vetra.io": "https://registry.vetra.io",
};

/** The registry of the stack `cloudSwitchboardUrl` belongs to, or null. */
export function stackRegistry(cloudSwitchboardUrl: string | null | undefined): string | null {
  const url = cloudSwitchboardUrl?.trim();
  if (!url) return null;
  try {
    return STACK_REGISTRIES[new URL(url).hostname] ?? null;
  } catch {
    return null;
  }
}

/**
 * The registry a launch publishes to: the usual lookup (flag/config,
 * PH_REGISTRY_URL, the project's powerhouse.config.json), then — in a Studio
 * only (`environmentId` set) — its stack's registry. Nothing is written to the
 * project. Throws like `resolveRegistryUrl` when none applies.
 */
export function resolveLaunchRegistryUrl(options: {
  registry?: string | null;
  projectPath: string;
  env?: Record<string, string | undefined>;
  environmentId?: string | null;
  cloudSwitchboardUrl?: string | null;
}): string {
  const found = findRegistryUrl(options);
  if (found) return found;
  const fallback = options.environmentId?.trim() ? stackRegistry(options.cloudSwitchboardUrl) : null;
  return fallback ?? resolveRegistryUrl(options);
}
