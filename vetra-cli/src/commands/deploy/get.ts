import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatSchema, renderProjected } from "../spec/_helpers.js";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  CLOUD_BASE_DOMAIN,
  type EnvironmentSummary,
} from "@powerhousedao/vetra-cloud-client";
import {
  findMyEnvironment,
  listMyEnvironments,
} from "../../cloud/environments-read.js";

function describe(env: EnvironmentSummary): string {
  const host = env.subdomain ? `${env.subdomain}.${CLOUD_BASE_DOMAIN}` : "(no host)";
  const lines = [
    `${env.name ?? "(unnamed)"}  [${env.status ?? "unknown"}]`,
    `host:   ${host}`,
    `id:     ${env.id}`,
  ];
  if (env.owner) lines.push(`owner:  ${env.owner}`);
  if (env.customDomain) lines.push(`domain: ${env.customDomain}`);
  lines.push("(service/package detail lands with the write path)");
  return lines.join("\n");
}

export const deployEnvironmentGet = defineCommand({
  id: "deploy-environment-get",
  description:
    "Show a Vetra Cloud deployment environment's details (live data; requires Renown authorization — check with whoami). Service/package detail comes with the write path.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Environment to read — accepts id, name, or subdomain (see deploy-environment-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe("Return the full environment object as JSON."),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection over the environment object, e.g. $.status.",
      ),
    format: formatSchema.optional(),
  }),
  execute: async (input, { workdir, config }) => {
    requireOption(
      input.name,
      "name",
      "Pass an environment id, name, or subdomain (see deploy-environment-list).",
    );
    const ctx = { workdir, config };
    const env = await findMyEnvironment(ctx, input.name);
    if (!env) {
      const candidates = (await listMyEnvironments(ctx, "MINE"))
        .flatMap((e) => [e.name ?? "", e.subdomain ?? ""])
        .filter(Boolean);
      throw unknownValueError({
        subject: "environment",
        value: input.name,
        candidates,
        knownLabel: "Available environments",
      });
    }
    if (input.full || input.filter) {
      return { text: renderProjected(env, input.filter ?? "$", input.format) };
    }
    return { text: describe(env) };
  },
});
