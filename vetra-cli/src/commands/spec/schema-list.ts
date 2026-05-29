import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatColumns } from "./_helpers.js";
import { listSpecModels } from "./registry.js";

export const specSchemaList = defineCommand({
  id: "spec-schema-list",
  description: "List known document model types.",
  inputSchema: z.object({}),
  execute: async () => {
    const models = listSpecModels();
    if (models.length === 0) {
      return { text: "(no schemas registered)" };
    }
    const rows = models.map((m) => [m.type, m.name, m.description]);
    return {
      text: formatColumns(rows),
    };
  },
});
