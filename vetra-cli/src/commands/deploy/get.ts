import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatSchema, renderProjected } from "../spec/_helpers.js";
import { describeEnvironment, resolveEnvironment } from "./_helpers.js";

export const deployEnvironmentGet = defineCommand({
  id: "deploy-environment-get",
  description:
    "Show a Vetra Cloud deployment environment's details. NOTE: cloud auth is not wired up yet — this returns mocked data.",
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
        "JSONPath (RFC 9535) projection over the environment object, e.g. $.services[?(@.enabled)].type.",
      ),
    format: formatSchema.optional(),
  }),
  execute: async (input) => {
    const env = resolveEnvironment(input.name);
    if (input.full || input.filter) {
      return { text: renderProjected(env, input.filter ?? "$", input.format) };
    }
    return { text: describeEnvironment(env) };
  },
});
