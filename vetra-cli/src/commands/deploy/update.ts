import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { describeEnvironment, resolveEnvironment } from "./_helpers.js";
import {
  environmentStatusSchema,
  packageListSchema,
  parsePackageSpec,
  serviceListSchema,
  updateEnvironment,
} from "./_mock.js";

export const deployEnvironmentUpdate = defineCommand({
  id: "deploy-environment-update",
  description:
    "Update a Vetra Cloud deployment environment — rename it, toggle services, manage packages, or move its deployment status. NOTE: cloud auth is not wired up yet — this operates on mocked data.",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe("Environment to update — accepts id, name, or subdomain."),
    label: z.string().optional().describe("New display name."),
    status: environmentStatusSchema
      .optional()
      .describe(
        "Set deployment status. Common transitions: DRAFT/CHANGES_PENDING → CHANGES_APPROVED (approve), any → TERMINATING (terminate).",
      ),
    enableService: serviceListSchema
      .optional()
      .describe('Services to enable, e.g. "SWITCHBOARD,FUSION".'),
    disableService: serviceListSchema
      .optional()
      .describe('Services to disable, e.g. "FUSION".'),
    addPackage: packageListSchema
      .optional()
      .describe(
        'Packages to add as "name@version" (version optional), e.g. "@acme/todo@1.2.0".',
      ),
    removePackage: packageListSchema
      .optional()
      .describe('Package names to remove, e.g. "@acme/todo".'),
  }),
  execute: async (input) => {
    const env = resolveEnvironment(input.name);
    const next = updateEnvironment(env, {
      label: input.label,
      status: input.status,
      enableServices: input.enableService,
      disableServices: input.disableService,
      addPackages: input.addPackage?.map(parsePackageSpec),
      removePackages: input.removePackage,
    });
    return {
      text: `Updated environment "${next.label}" (${next.id}).\n${describeEnvironment(
        next,
      )}`,
    };
  },
});
