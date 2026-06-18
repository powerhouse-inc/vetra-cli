import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  describeEnvironmentState,
  packageListSchema,
  parsePackageSpec,
  resolveEnvironment,
  serviceListSchema,
} from "./_helpers.js";
import { applyEnvironmentUpdate } from "../../cloud/environments-write.js";

export const deployEnvironmentUpdate = defineCommand({
  id: "deploy-environment-update",
  description:
    "Update a Vetra Cloud deployment environment — rename it, toggle services, manage packages, or drive its deployment status. Pushes signed edits to the live environment at staging.vetra.io; requires Renown authorization (check with whoami).",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe("Environment to update — accepts id, name, or subdomain."),
    label: z.string().optional().describe("New display name."),
    transition: z
      .enum(["CHANGES_APPROVED", "TERMINATING"])
      .optional()
      .describe(
        "Drive the deployment status. CHANGES_APPROVED approves pending changes (from DRAFT/CHANGES_PENDING); TERMINATING terminates the environment.",
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
  execute: async (input, { workdir, config }) => {
    const ctx = { workdir, config };
    const env = await resolveEnvironment(ctx, input.name);
    const state = await applyEnvironmentUpdate(ctx, env.id, {
      label: input.label,
      transition: input.transition,
      enableServices: input.enableService,
      disableServices: input.disableService,
      addPackages: input.addPackage?.map(parsePackageSpec),
      removePackages: input.removePackage,
    });
    return {
      text: `Updated environment "${state.label ?? env.id}" (${env.id}).\n${describeEnvironmentState(
        state,
        env.id,
      )}`,
    };
  },
});
