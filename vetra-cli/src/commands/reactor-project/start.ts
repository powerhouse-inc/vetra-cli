import path from "node:path";
import { z } from "zod";
import { formatStatus } from "@powerhousedao/ph-clint";
import { defineCommand } from "../../framework.js";

/**
 * Idempotent `reactor-project-start`. Overrides the ph-clint auto-injected
 * version (user-defined commands win in `defineCli`'s command map) so that
 * calling start against an already-running workdir returns the existing
 * instance instead of failing with "Service has reached max instances (1)".
 *
 * The system prompt promises this behaviour ("idempotent and a no-op when
 * already running"); previously a trigger that auto-starts the reactor on
 * the first spec change would race with the agent's explicit start call
 * and force a stop/start dance.
 */
export const reactorProjectStart = defineCommand({
  id: "reactor-project-start",
  description: "Start Reactor Project (idempotent)",
  inputSchema: z.object({
    workdir: z
      .string()
      .optional()
      .describe("Working directory for the service"),
    watch: z.boolean().optional().describe("Enable file watching"),
    connectPort: z.coerce
      .number()
      .optional()
      .describe("Connect Studio port"),
    switchboardPort: z.coerce
      .number()
      .optional()
      .describe("Vetra Switchboard port"),
  }),
  execute: async (input, context) => {
    const services = context.services;
    if (!services) throw new Error("No services configured");

    const resolvedWorkdir = input.workdir
      ? path.resolve(context.workdir, input.workdir)
      : context.workdir;

    const existing = services
      .list("reactor-project")
      .find(
        (s) =>
          s.workdir === resolvedWorkdir &&
          (s.status === "ready" || s.status === "starting"),
      );
    if (existing) {
      return { text: formatStatus(existing) };
    }

    const params: Record<string, unknown> = {};
    if (input.watch !== undefined) params.watch = input.watch;
    if (input.connectPort !== undefined) params.connectPort = input.connectPort;
    if (input.switchboardPort !== undefined)
      params.switchboardPort = input.switchboardPort;

    try {
      const instanceId = await services.start("reactor-project", {
        workdir: resolvedWorkdir,
        cwd: resolvedWorkdir,
        params: Object.keys(params).length > 0 ? params : undefined,
      });
      const status = services
        .list("reactor-project")
        .find((s) => s.instanceId === instanceId);
      return { text: status ? formatStatus(status) : "" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `✗ reactor-project: ${msg}` };
    }
  },
});
