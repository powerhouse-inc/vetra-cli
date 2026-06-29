import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatSchema, renderProjected } from "../spec/_helpers.js";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  findMyEnvironment,
  listMyEnvironments,
} from "../../cloud/environments-read.js";
import { loadEnvironmentState } from "../../cloud/environments-write.js";
import {
  describeEnvironmentState,
  describeEnvironmentSummary,
} from "./_helpers.js";

export const deployEnvironmentGet = defineCommand({
  id: "deploy-environment-get",
  description:
    "Show a Vetra Cloud deployment environment's details — status, services, and installed packages with their versions (live data; requires Renown authorization — check with whoami). Read $.packages to see which package@version is installed when deciding whether a deploy is needed.",
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

    // The summary (myEnvironments) carries no packages/services, so pull the
    // full document. Fall back to the summary if the pull fails (e.g. the
    // document can't be loaded) so a get never hard-fails.
    const state = await loadEnvironmentState(ctx, env.id).catch(() => null);

    if (input.full || input.filter) {
      // Project over the full state (so `$.packages`, `$.services` resolve),
      // keeping the document id the summary carried.
      const obj = state ? { ...state, id: env.id } : env;
      return { text: renderProjected(obj, input.filter ?? "$", input.format) };
    }
    return {
      text: state
        ? describeEnvironmentState(state, env.id)
        : describeEnvironmentSummary(env),
    };
  },
});
