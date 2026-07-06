import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { DEFAULT_PH_VERSION } from "../../constants.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { describeEnvironmentState, serviceListSchema } from "./_helpers.js";
import { createCloudEnvironment } from "../../cloud/environments-write.js";

export const deployEnvironmentCreate = defineCommand({
  id: "deploy-environment-create",
  description:
    "Create a Vetra Cloud deployment environment. A <subdomain>.vetra.io host is assigned automatically; the environment starts in DRAFT with CONNECT enabled. Enabled services are pinned to the local stack's framework version so the deployment matches the Studio. Creates a live environment at staging.vetra.io owned by the signed-in user; requires Renown authorization (check with whoami).",
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
    version: z
      .string()
      .optional()
      .describe(
        `Leave empty. Enabled services are pinned to the local stack version (${DEFAULT_PH_VERSION}) automatically so the deployment matches the Studio. Only set this to override that default when the user explicitly asks for a specific version, or a known version mismatch justifies it.`,
      ),
  }),
  execute: async (input, { workdir, config }) => {
    requireOption(input.name, "name", "The environment needs a display name.");
    const { id, state } = await createCloudEnvironment(
      { workdir, config },
      { label: input.name, services: input.services, version: input.version },
    );
    return {
      text: `Created environment "${state.label ?? input.name}"  id: ${id}  status: ${state.status}\n${describeEnvironmentState(
        state,
        id,
      )}`,
    };
  },
});
