import { resolveToolComponent } from "./registry.js";
import type { ToolRenderer } from "./types.js";

/**
 * Resolver passed to `<ChatSession toolRenderers>`. Each recognized tool has its
 * own component under `tools/` (see `registry.ts`); unrecognized tools return
 * `undefined` and fall back to clint-common's built-in default renderer.
 */
export const vetraToolRenderers = (
  toolName: string,
): ToolRenderer | undefined => resolveToolComponent(toolName);

export { resolveToolComponent, type ToolComponent } from "./registry.js";
export type {
  ToolRenderProps,
  ToolRenderer,
  ToolRenderers,
  ToolRenderState,
} from "./types.js";
