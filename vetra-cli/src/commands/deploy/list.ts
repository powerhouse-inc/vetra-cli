import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { CLOUD_BASE_DOMAIN } from "@powerhousedao/vetra-cloud-client";
import { listEnvironmentsWithStudioFlag } from "../../cloud/environments-write.js";

/** Public host for an environment: custom domain wins, else the generated
 * subdomain under the cloud base domain; null when neither is set. */
function domainOf(e: {
  subdomain: string | null;
  customDomain: string | null;
}): string | null {
  return (
    e.customDomain ??
    (e.subdomain ? `${e.subdomain}.${CLOUD_BASE_DOMAIN}` : null)
  );
}

export const deployEnvironmentList = defineCommand({
  id: "deploy-environment-list",
  description:
    "List all Vetra Cloud environments (name, domain, status, id, isStudio), including Studio hosts. Requires Renown authorization.",
  inputSchema: z.object({
    scope: z
      .enum(["MINE", "ALL"])
      .default("MINE")
      .describe(
        'Which environments to list: "MINE" (default, your own) or "ALL".',
      ),
    status: z
      .string()
      .optional()
      .describe('Filter by status, e.g. "READY", "DEPLOYING", "DRAFT".'),
  }),
  outputSchema: z.array(z.object({
    name: z.string(),
    domain: z.string().nullable(),
    status: z.string(),
    id: z.string(),
    isStudio: z.boolean().describe('Whether the environment is a Vetra Studio host'),
  })),
  execute: async (input, { workdir, config }) => {
    let items = await listEnvironmentsWithStudioFlag(
      { workdir, config },
      input.scope,
    );
    if (input.status) {
      const want = input.status.toUpperCase();
      items = items.filter((e) => (e.status ?? "").toUpperCase() === want);
    }
    return items.map((e) => ({
      name: e.name,
      domain: domainOf(e),
      status: e.status,
      id: e.id,
      isStudio: e.isStudio,
    }));
  },
});
