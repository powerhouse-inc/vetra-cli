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
