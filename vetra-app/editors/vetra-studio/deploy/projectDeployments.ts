import { isStudioEnvironment } from "@powerhousedao/vetra-cloud-client";
import type { EnvironmentSummary } from "./cloudGraphql.js";
import { CLOUD_BASE_DOMAIN } from "./config.js";
import type { EnvInstall } from "./useInstalledPackages.js";
import type { ReleaseStatus } from "./useReleaseStatuses.js";

/** Per-(project, environment) freshness, folding "source changed since publish"
 * and "env runs an older version" into one user-facing notion. */
export type EnvDeployState =
  | "live-current" // installed and running the latest published work
  | "update-available" // installed but behind (newer release exists or unpublished changes)
  | "not-deployed"; // package not installed here

/** An openable service running in an environment (Connect, Switchboard, …).
 * The apex domain itself serves nothing — the services do. */
export type EnvServiceLink = { type: string; label: string; url: string };

/** This project's status in one environment, fully resolved for render. */
export type ProjectEnvDeployment = {
  env: EnvironmentSummary;
  /** Host the app is reachable at (custom domain or generated subdomain). */
  url: string | null;
  installed: boolean;
  installedVersion: string | null;
  state: EnvDeployState;
  /** Enabled services with their public URLs, for the "Open" menu. */
  services: EnvServiceLink[];
};

const SERVICE_LABEL: Record<string, string> = {
  CONNECT: "Connect",
  SWITCHBOARD: "Switchboard",
  FUSION: "Fusion",
};
const SERVICE_SUFFIX: Record<string, string> = { SWITCHBOARD: "/graphql" };
const SERVICE_ORDER = ["CONNECT", "FUSION", "SWITCHBOARD"];

/** Build the public URLs for an environment's enabled services as
 * `<subdomain>-<service>` under the base domain (mirrors the environment
 * detail's host construction). The apex service carries no suffix. */
export function resolveServiceLinks(global: {
  genericSubdomain?: string | null;
  genericBaseDomain?: string | null;
  services: { type: string; enabled: boolean; prefix: string }[];
}): EnvServiceLink[] {
  const subdomain = global.genericSubdomain;
  if (!subdomain) return [];
  const base = global.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  const links: EnvServiceLink[] = [];
  for (const s of global.services) {
    const label = SERVICE_LABEL[s.type];
    if (!s.enabled || !label) continue;
    // `prefix` is the document's schema field name; it's the service slug.
    const serviceSlug = s.prefix;
    const host = serviceSlug
      ? `${subdomain}-${serviceSlug}.${base}`
      : `${subdomain}.${base}`;
    links.push({
      type: s.type,
      label,
      url: `https://${host}${SERVICE_SUFFIX[s.type] ?? ""}`,
    });
  }
  links.sort(
    (a, b) => SERVICE_ORDER.indexOf(a.type) - SERVICE_ORDER.indexOf(b.type),
  );
  return links;
}

/** The deploy detail's data, gated on sign-in + every source resolving, so the
 * variants render fully-formed (no per-row flicker). */
export type DeployData =
  | { kind: "unauthenticated" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; environments: ProjectEnvDeployment[] };

/** The project's package, resolved from its package.json via the local API. */
export type PackageView =
  | { status: "loading" }
  | { status: "ready"; name: string; version: string }
  | { status: "error"; message: string };

/** Public host for an environment: custom domain wins, else the generated
 * subdomain under the cloud base domain. */
export function envHost(env: EnvironmentSummary): string | null {
  return (
    env.customDomain ??
    (env.subdomain ? `${env.subdomain}.${CLOUD_BASE_DOMAIN}` : null)
  );
}

/** Resolve this project's deployment status across every environment. */
export function deriveEnvDeployments(args: {
  environments: EnvironmentSummary[];
  byEnv: EnvInstall[];
  packageName: string;
  release: ReleaseStatus;
}): ProjectEnvDeployment[] {
  const { environments, byEnv, packageName, release } = args;
  const byId = new Map(byEnv.map((e) => [e.envId, e]));

  return environments.flatMap((env) => {
    const entry = byId.get(env.id);
    const installs = entry?.packages;
    // Vetra Studio environments host the Studio itself — never deploy targets,
    // and not shown in the deploy UI.
    if (isStudioEnvironment(installs?.keys() ?? [])) return [];
    const installed = installs?.has(packageName) ?? false;
    const installedVersion = installs?.get(packageName) ?? null;

    let state: EnvDeployState;
    if (!installed) {
      state = "not-deployed";
    } else if (
      release.known &&
      (release.needsRelease ||
        (release.publishedVersion != null &&
          installedVersion != null &&
          installedVersion !== release.publishedVersion))
    ) {
      state = "update-available";
    } else {
      state = "live-current";
    }

    return [
      {
        env,
        url: envHost(env),
        installed,
        installedVersion,
        state,
        services: entry?.services ?? [],
      },
    ];
  });
}
