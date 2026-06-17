import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { describeEnvironment } from "./_helpers.js";
import {
  createEnvironment,
  environmentHost,
  serviceListSchema,
} from "./_mock.js";

export const deployEnvironmentCreate = defineCommand({
  id: "deploy-environment-create",
  description:
    "Create a Vetra Cloud deployment environment. A <subdomain>.vetra.io host is assigned automatically; the environment starts in DRAFT with CONNECT enabled. NOTE: cloud auth is not wired up yet — this operates on mocked data.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe("Human-readable environment name (its label)."),
    services: serviceListSchema
      .optional()
      .describe(
        'Services to enable on create, e.g. "CONNECT,SWITCHBOARD". Defaults to CONNECT. One of CONNECT, SWITCHBOARD, FUSION.',
      ),
  }),
  execute: async (input) => {
    requireOption(input.name, "name", "The environment needs a display name.");
    const env = createEnvironment({
      label: input.name,
      services: input.services,
    });
    return {
      text: `Created environment "${env.label}"  id: ${env.id}  ${environmentHost(
        env,
      )}  status: ${env.status}\n${describeEnvironment(env)}`,
    };
  },
});
