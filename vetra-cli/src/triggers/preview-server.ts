/**
 * Preview-server trigger — long-running HTTP endpoint for the vetra-studio
 * BUILD pane.
 *
 * Triggers are the framework's contract for side-effecty work that needs
 * full runtime access (services + event bus). We use one here because:
 *   - `/resolve` and `/start` need `services.list()` and `services.start()`,
 *     which only the framework-issued `ServiceManager` provides.
 *   - `/events` (SSE) needs to bridge the framework's event bus to browser
 *     EventSource clients, which `ctx.context.on` exposes.
 *
 * `setup()` boots the http server and captures the runtime handles in
 * closures shared with the http handlers. `poll()` returns null forever —
 * this trigger never emits work items; it exists purely for its setup-
 * lifetime side effects. `teardown()` closes the server on daemon shutdown.
 */
import { defineTrigger } from "../framework.js";
import {
  DEFAULT_PREVIEW_SERVER_PORT,
  startPreviewServer,
  type PreviewServerHandle,
} from "../preview-server/index.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { DEFAULT_PH_VERSION } from "../ph-version.gen.js";
import { VETRA_CLI_VERSION } from "../version-banner.js";

interface TriggerState {
  handle: PreviewServerHandle | undefined;
}

export const previewServerTrigger = defineTrigger<TriggerState>({
  id: "preview-server",
  type: "condition",
  state: () => ({ handle: undefined }),

  async setup(ctx) {
    const services = ctx.commandContext.services;
    const on = ctx.commandContext.on;
    const workdir = ctx.context.workdir;
    if (!services) {
      ctx.context.log?.warn?.(
        "[preview-server] no ServiceManager in context — skipping start",
      );
      return;
    }
    if (!on) {
      ctx.context.log?.warn?.(
        "[preview-server] no event-bus accessor in context — skipping start",
      );
      return;
    }

    const { renownUrl } = resolveCloudConfig(ctx.context.config);

    try {
      ctx.state.handle = await startPreviewServer({
        services,
        subscribe: (event, handler) => on(event, handler),
        workdir,
        renownUrl,
        registryUrl: ctx.context.config.registryUrl,
        port: DEFAULT_PREVIEW_SERVER_PORT,
        proxyPublicUrl: ctx.commandContext.proxy?.url,
        versions: { vetraCli: VETRA_CLI_VERSION, ph: DEFAULT_PH_VERSION },
        getReactor: () => getEmbeddedDrive(ctx.commandContext),
        agentLogging: ctx.context.config.agentLogging,
        log: {
          info: (m) => ctx.context.log?.info?.(m),
          error: (m) => ctx.context.log?.error?.(m),
          debug: (m) => ctx.context.log?.debug?.(m),
        },
      });
    } catch (err) {
      ctx.context.log?.error?.(
        `[preview-server] failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  async teardown(ctx) {
    await ctx.state.handle?.stop();
    ctx.state.handle = undefined;
  },

  async poll() {
    return null;
  },
});
