import { addActions, saveSpec } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { actionInputSchema, loadByName, resolveActionsInput } from "./_helpers.js";

export const specUpdate = defineCommand({
  id: "spec-update",
  description: "Apply actions to a spec via the document model's reducer.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z.string().describe("Spec document name."),
    actions: z
      .preprocess((v) => {
        /* Tool/MCP callers pass a real array; shell users pass `--actions
         * '[...]'`, which arrives as a JSON-encoded string. Accept both. */
        if (typeof v !== "string") return v;
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return v;
        }
      }, z.array(actionInputSchema))
      .optional()
      .describe(
        "Inline JSON array of actions. Preferred for agent tool calls — no filesystem detour needed.",
      ),
    from: z
      .string()
      .optional()
      .describe(
        "Path to a JSON file containing the actions array. Use for human CLI workflows.",
      ),
  }),
  execute: async (input, { workdir }) => {
    const base = resolveReactorProjectPath(workdir, input.project);
    const actions = await resolveActionsInput({
      actions: input.actions,
      from: input.from,
    });
    const doc = await loadByName(base, input.name);
    const next = addActions(doc, actions);
    const opsCount =
      next.operations.global.length + next.operations.local.length;
    const path = await saveSpec(next, base);
    return {
      text: `Applied ${actions.length} action(s) to ${next.header.documentType} "${next.header.name}" (now ${opsCount} op(s) total) → ${path}`,
      data: {
        path,
        document: {
          header: next.header,
          state: next.state,
          operationsCount: opsCount,
        },
      },
    };
  },
});
