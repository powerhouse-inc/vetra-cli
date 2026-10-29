import {
  matchEnvironments,
  type EnvironmentSummary,
} from "@powerhousedao/vetra-cloud-client";
import { unknownValueError } from "../../helpers/cli-errors.js";

function label(e: EnvironmentSummary): string {
  const name = e.name ?? "(unnamed)";
  return e.subdomain ? `${name} (${e.subdomain}, ${e.id})` : `${name} (${e.id})`;
}

/**
 * Resolve an `<env>` argument (document id, name, or subdomain) against the
 * caller's environments. Unknown → did-you-mean error; more than one match →
 * an ambiguity error listing every match so the caller can retry with an id.
 */
export function resolveEnvRef(
  items: EnvironmentSummary[],
  ref: string,
): EnvironmentSummary {
  const matches = matchEnvironments(items, ref);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      [
        `Environment "${ref}" is ambiguous — ${matches.length} environments match:`,
        ...matches.map((e) => `  ${label(e)}`),
        "Pass the environment id instead.",
      ].join("\n"),
    );
  }
  const candidates = items
    .flatMap((e) => [e.name ?? "", e.subdomain ?? ""])
    .filter(Boolean);
  throw unknownValueError({
    subject: "environment",
    value: ref,
    candidates,
    knownLabel: candidates.length
      ? "Available environments"
      : undefined,
    context: candidates.length ? undefined : "(you have no environments)",
  });
}
