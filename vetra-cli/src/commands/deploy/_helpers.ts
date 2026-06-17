import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  environmentHost,
  findEnvironment,
  listEnvironments,
  serviceHost,
  type Environment,
} from "./_mock.js";

/** Resolve an environment by id, name, or subdomain, or throw an actionable
 * error (missing value → required-option; unknown → did-you-mean list). */
export function resolveEnvironment(query: string): Environment {
  requireOption(
    query,
    "name",
    "Pass an environment id, name, or subdomain (see deploy-environment-list).",
  );
  const env = findEnvironment(query);
  if (env) return env;
  const candidates = listEnvironments().flatMap((e) => [e.label, e.subdomain]);
  throw unknownValueError({
    subject: "environment",
    value: query,
    candidates,
    knownLabel: "Available environments",
  });
}

/** Human-readable multi-line detail view of an environment. */
export function describeEnvironment(env: Environment): string {
  const lines = [
    `${env.label}  [${env.status}]`,
    `host:     ${environmentHost(env)}`,
    `id:       ${env.id}`,
  ];
  if (env.owner) lines.push(`owner:    ${env.owner}`);
  if (env.customDomain) lines.push(`domain:   ${env.customDomain}`);
  lines.push(`registry: ${env.defaultPackageRegistry}`);
  lines.push("services:");
  for (const svc of env.services) {
    lines.push(
      `  ${svc.enabled ? "✓" : "·"} ${svc.type.padEnd(11)} ${
        svc.enabled ? serviceHost(env, svc) : "(off)"
      }`,
    );
  }
  if (env.packages.length > 0) {
    lines.push("packages:");
    for (const p of env.packages) {
      lines.push(`  ${p.name}${p.version ? `@${p.version}` : ""}`);
    }
  } else {
    lines.push("packages: (none)");
  }
  return lines.join("\n");
}
