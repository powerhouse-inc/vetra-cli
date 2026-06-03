/**
 * Prints `Vetra Studio: <url>/d/<driveId>` once on startup, so the
 * full noisy ph-clint banner ends with a single line a user can click.
 *
 * The drive id comes from `ctx.reactor()` (always populated by the
 * framework). The URL prefers the embedded proxy (Connect owns its `/`
 * catch-all, and the proxied origin is the one all browser-facing URLs are
 * stamped with), falling back to the direct Connect endpoint from the live
 * ServiceManager when the proxy is disabled.
 */
import { defineTrigger } from "../framework.js";

const STUDIO_SERVICE_NAME = "vetra-studio";

export const studioUrlTrigger = defineTrigger({
  id: "studio-url",
  type: "condition",

  async setup(ctx) {
    const reactor = await ctx.reactor();
    const driveId = reactor?.personalDriveId ?? reactor?.driveId;
    const services = ctx.commandContext.services;
    if (!driveId || !services) return;

    const connectUrl = services
      .list()
      .find(
        (instance) =>
          instance.name === STUDIO_SERVICE_NAME &&
          instance.status === "ready",
      )?.endpoints?.["connect-studio"];
    const studioUrl = ctx.commandContext.proxy?.url ?? connectUrl;
    if (!studioUrl) return;

    const base = studioUrl.replace(/\/+$/, "");

    console.log(`Vetra Studio: ${base}/d/${driveId}`);
  },

  async poll() {
    return null;
  },
});
