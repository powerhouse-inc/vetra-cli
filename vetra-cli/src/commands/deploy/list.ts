import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatColumns } from "../spec/_helpers.js";
import { environmentHost, listEnvironments } from "./_mock.js";

export const deployEnvironmentList = defineCommand({
  id: "deploy-environment-list",
  description:
    "List Vetra Cloud deployment environments. NOTE: cloud auth is not wired up yet — this returns mocked data.",
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
  execute: async (input) => {
    const items = listEnvironments({ scope: input.scope, status: input.status });
    if (items.length === 0) {
      return { text: "(no environments)" };
    }
    const rows = items.map((e) => [
      e.label,
      environmentHost(e),
      e.status,
      e.id,
    ]);
    return { text: formatColumns(rows) };
  },
});
