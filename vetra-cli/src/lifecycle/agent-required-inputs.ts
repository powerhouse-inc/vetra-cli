/**
 * Shows the agent which tool inputs it must pass.
 *
 * Several spec commands declare a required input as `z.string().default("")`
 * so the CLI reports one clear "Missing required option --x." instead of
 * commander's own (see `requireOption`). The model reads that schema too:
 * a defaulted field is optional to it, so it left `type` / `name` out and
 * lost a step to the error each time — on staging up to 18 failed
 * spec-create / spec-update / spec-preview-create calls in one build.
 *
 * This wrap marks those fields required (non-empty) in the schema the agent
 * sees. The CLI keeps its own schema; the command still checks the value.
 */
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { z } from "zod";

/** Tool → the defaulted string inputs the command can't run without. */
export const AGENT_REQUIRED_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "spec-create": ["type"],
  "spec-update": ["name"],
  "spec-get": ["name"],
  "spec-delete": ["name"],
  "spec-preview-create": ["type"],
  "spec-preview-get": ["name"],
  "spec-preview-update": ["name"],
  "spec-preview-delete": ["name"],
};

/** `schema` with `fields` as required non-empty strings; as is when it isn't an object schema. */
export function requireFields(schema: unknown, fields: readonly string[]): unknown {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = schema.shape as Record<string, z.ZodType>;
  const required: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const current = shape[field];
    if (!current) continue;
    const next = z.string().min(1);
    required[field] = current.description ? next.describe(current.description) : next;
  }
  return Object.keys(required).length > 0 ? schema.extend(required) : schema;
}

export function agentRequiredInputs(): LifecycleHook {
  return {
    name: "agent-required-inputs",
    onInit() {
      return {
        contribute: {
          tool(name, tool) {
            const fields = AGENT_REQUIRED_INPUTS[name];
            if (!fields) return tool;
            const { inputSchema } = tool as { inputSchema?: unknown };
            const next = requireFields(inputSchema, fields);
            return next === inputSchema ? tool : { ...tool, inputSchema: next };
          },
        },
      };
    },
  };
}
