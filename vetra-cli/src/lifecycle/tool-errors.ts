/**
 * Makes thrown tool errors survive serialization to the model.
 *
 * The AI SDK reports a tool-execute throw with `errorMode: "json"`, and the
 * Anthropic provider sends `JSON.stringify(error)` as the tool result. A bare
 * `Error` has non-enumerable `message`/`stack`, so it collapses to `{}` and
 * the model sees an empty object instead of the failure reason.
 *
 * This wraps every tool's `execute` and, on a thrown `Error`, attaches a
 * `toJSON` returning the message. The error is mutated in place so identity is
 * preserved (instanceof checks, abort signals); non-`Error` throws already
 * serialize. Registered last in the lifecycle array so it is the outermost
 * wrapper and catches throws from inner hooks (e.g. ts-check) and the tools
 * themselves alike.
 */
import type { LifecycleHook } from "@powerhousedao/ph-clint";

function ensureSerializable(err: unknown): unknown {
  if (err instanceof Error && !("toJSON" in err)) {
    const { message } = err;
    Object.defineProperty(err, "toJSON", { value: () => message });
  }
  return err;
}

export function serializableToolErrors(): LifecycleHook {
  return {
    name: "tool-errors",
    onInit() {
      return {
        contribute: {
          tool(_name, tool) {
            const innerExecute = tool.execute.bind(tool);
            return {
              ...tool,
              execute: async (...args: unknown[]) => {
                try {
                  return await innerExecute(...args);
                } catch (err) {
                  throw ensureSerializable(err);
                }
              },
            };
          },
        },
      };
    },
  };
}
