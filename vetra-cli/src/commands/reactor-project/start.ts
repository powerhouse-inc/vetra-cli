import path from "node:path";
import { z } from "zod";
import { formatStatus } from "@powerhousedao/ph-clint";
import type { ServiceInstanceStatus, CommandContext } from "@powerhousedao/ph-clint";
import { defineCommand } from "../../framework.js";
import { REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH } from "../../constants.js";

/**
 * Mirror the embedded `/switchboard/*` proxy scheme for the project's
 * switchboard, under /reactor-project/switchboard. The `/d/`-aligned route
 * shape makes the proxy send the X-Forwarded-Prefix the switchboard needs to
 * announce proxied follow-up endpoints, so the drive URLs ph vetra rebases
 * via --drives-public-base resolve through the proxy.
 */
function registerSwitchboardRoutes(
  proxy: NonNullable<CommandContext["proxy"]>,
  status: ServiceInstanceStatus,
): void {
  const sbUrl = status.endpoints?.["vetra-switchboard"];
  const mcpUrl = status.endpoints?.["mcp-server"];
  if (!sbUrl) return;

  const base = REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH;
  const routes = [
    { prefix: `${base}/d/`, upstream: new URL("/d/", sbUrl), ws: false },
    { prefix: `${base}/graphql`, upstream: new URL("/graphql", sbUrl), ws: false },
    {
      prefix: `${base}/attachments/`,
      upstream: new URL("/attachments/", sbUrl),
      ws: false,
    },
    ...(mcpUrl
      ? [{ prefix: `${base}/mcp`, upstream: new URL("/mcp", mcpUrl), ws: true }]
      : []),
  ];
  const existing = new Set(proxy.routes().map((r) => r.prefix));
  for (const route of routes) {
    if (existing.has(route.prefix)) continue;
    proxy.addRoute({ ...route, source: "service:reactor-project" });
  }
}

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
      if (context.proxy && existing.status === "ready") {
        registerSwitchboardRoutes(context.proxy, existing);
      }
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
      if (status && context.proxy) {
        registerSwitchboardRoutes(context.proxy, status);
      }
      return { text: status ? formatStatus(status) : "" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: `✗ reactor-project: ${msg}` };
    }
  },
});
