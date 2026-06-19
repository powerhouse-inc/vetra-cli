import type { ChatSessionProps } from "@powerhousedao/clint-common/editors";
import type { ComponentProps } from "react";

// clint-common exposes the tool-render mechanism via the `toolRenderers` prop
// but doesn't re-export the renderer types from its public surface, so derive
// them from the one type that is exported: ChatSessionProps.

/** The `toolRenderers` prop shape accepted by <ChatSession>. */
export type ToolRenderers = NonNullable<ChatSessionProps["toolRenderers"]>;

/** Resolver branch of ToolRenderers; its return value is the renderer component. */
type ResolverFn = Extract<ToolRenderers, (toolName: string) => unknown>;

/** A component that renders one agent tool call/result. */
export type ToolRenderer = NonNullable<ReturnType<ResolverFn>>;

/** Props clint-common passes to a renderer (args/result already JSON-parsed). */
export type ToolRenderProps = ComponentProps<ToolRenderer>;

/** Tool invocation lifecycle state, for status indicators. */
export type ToolRenderState = ToolRenderProps["state"];
