import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatColumns } from "../spec/_helpers.js";
import { CLOUD_BASE_DOMAIN } from "@powerhousedao/vetra-cloud-client";
import { listMyEnvironments } from "../../cloud/environments-read.js";

function host(subdomain: string | null): string {
  return subdomain ? `${subdomain}.${CLOUD_BASE_DOMAIN}` : "(no host)";
}

export const deployEnvironmentList = defineCommand({
  id: "deploy-environment-list",
  description:
    "List your Vetra Cloud deployment environments (live data from staging.vetra.io; requires Renown authorization — check with whoami).",
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
  execute: async (input, { workdir, config }) => {
    let items = await listMyEnvironments({ workdir, config }, input.scope);
    if (input.status) {
      const want = input.status.toUpperCase();
      items = items.filter((e) => (e.status ?? "").toUpperCase() === want);
    }
    if (items.length === 0) {
      return { text: "(no environments)" };
    }
    const rows = items.map((e) => [
      e.name ?? "(unnamed)",
      host(e.subdomain),
      e.status ?? "",
      e.id,
    ]);
    return { text: formatColumns(rows) };
  },
});
