import { z } from "zod";
import {
  CLOUD_BASE_DOMAIN,
  type EnvironmentSummary,
  type VetraCloudEnvironmentGlobalState,
} from "@powerhousedao/vetra-cloud-client";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  findMyEnvironment,
  listMyEnvironments,
  type ReadContext,
} from "../../cloud/environments-read.js";

/** Comma-separated string or array → array of service types. */
export const serviceListSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : v,
  z.array(z.enum(["CONNECT", "SWITCHBOARD", "FUSION"])),
);

/** Comma-separated string or array → array of package specs. */
export const packageListSchema = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v.split(",").map((s) => s.trim()).filter(Boolean)
      : v,
  z.array(z.string()),
);

/** "name@version" → { name, version }. A leading "@" (scoped pkg) is preserved;
 * only the version separator is split off. */
export function parsePackageSpec(spec: string): {
  name: string;
  version?: string;
} {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined };
}

/** Resolve an environment by id, name, or subdomain against the caller's cloud
 * environments, or throw an actionable error (missing value → required-option;
 * unknown → did-you-mean list). Returns the live summary (its `id` is the
 * document id used for writes). */
export async function resolveEnvironment(
  ctx: ReadContext,
  query: string,
): Promise<EnvironmentSummary> {
  requireOption(
    query,
    "name",
    "Pass an environment id, name, or subdomain (see deploy-environment-list).",
  );
  const env = await findMyEnvironment(ctx, query);
  if (env) return env;
  const candidates = (await listMyEnvironments(ctx, "MINE"))
    .flatMap((e) => [e.name ?? "", e.subdomain ?? ""])
    .filter(Boolean);
  throw unknownValueError({
    subject: "environment",
    value: query,
    candidates,
    knownLabel: "Available environments",
  });
}

function host(state: VetraCloudEnvironmentGlobalState): string {
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  return state.genericSubdomain ? `${state.genericSubdomain}.${base}` : "(no host)";
}

function serviceHost(
  state: VetraCloudEnvironmentGlobalState,
  serviceSlug: string,
): string {
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  return state.genericSubdomain
    ? `${state.genericSubdomain}-${serviceSlug}.${base}`
    : "(no host)";
}

const SERVICE_LABEL: Record<string, string> = {
  CONNECT: "Connect",
  SWITCHBOARD: "Switchboard",
  FUSION: "Fusion",
};
/** Switchboard's reachable endpoint is its GraphQL path, not the bare host. */
const SERVICE_PATH: Record<string, string> = { SWITCHBOARD: "/graphql" };

/** Public links for an environment's enabled services, as full https URLs in
 * the canonical `<subdomain>-<service>` form. Empty until a subdomain exists. */
export function serviceLinks(
  state: VetraCloudEnvironmentGlobalState,
): { label: string; url: string }[] {
  if (!state.genericSubdomain) return [];
  const links: { label: string; url: string }[] = [];
  for (const svc of state.services) {
    const label = SERVICE_LABEL[svc.type];
    if (!svc.enabled || !label) continue;
    links.push({
      label,
      url: `https://${serviceHost(state, svc.prefix)}${SERVICE_PATH[svc.type] ?? ""}`,
    });
  }
  return links;
}

/** Bulleted service-link list to quote when an env goes live, or null when no
 * service is reachable yet. Quote this verbatim — never hand-build the hosts. */
export function describeServiceLinks(
  state: VetraCloudEnvironmentGlobalState,
): string | null {
  const links = serviceLinks(state);
  if (links.length === 0) return null;
  return links.map((l) => `  ${l.label}: ${l.url}`).join("\n");
}

/** Human-readable summary from the read path (`myEnvironments`). Lacks the
 * service/package detail that only the loaded document carries. */
export function describeEnvironmentSummary(env: EnvironmentSummary): string {
  const host = env.subdomain ? `${env.subdomain}.${CLOUD_BASE_DOMAIN}` : "(no host)";
  const lines = [
    `${env.name ?? "(unnamed)"}  [${env.status ?? "unknown"}]`,
    `host:   ${host}`,
    `id:     ${env.id}`,
  ];
  if (env.owner) lines.push(`owner:  ${env.owner}`);
  if (env.customDomain) lines.push(`domain: ${env.customDomain}`);
  return lines.join("\n");
}

/** Human-readable multi-line detail view of an environment's document state. */
export function describeEnvironmentState(
  state: VetraCloudEnvironmentGlobalState,
  id: string,
): string {
  const lines = [
    `${state.label ?? "(unnamed)"}  [${state.status}]`,
    `host:     ${host(state)}`,
    `id:       ${id}`,
  ];
  if (state.owner) lines.push(`owner:    ${state.owner}`);
  if (state.defaultPackageRegistry) {
    lines.push(`registry: ${state.defaultPackageRegistry}`);
  }
  lines.push("services:");
  for (const svc of state.services) {
    lines.push(
      `  ${svc.enabled ? "✓" : "·"} ${svc.type.padEnd(11)} ${
        svc.enabled ? serviceHost(state, svc.prefix) : "(off)"
      }`,
    );
  }
  if (state.packages.length > 0) {
    lines.push("packages:");
    for (const p of state.packages) {
      lines.push(`  ${p.name}${p.version ? `@${p.version}` : ""}`);
    }
  } else {
    lines.push("packages: (none)");
  }
  return lines.join("\n");
}
