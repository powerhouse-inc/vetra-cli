/**
 * Prints `Vetra Studio: <connectUrl>/d/<driveId>` once on startup, so the
 * full noisy ph-clint banner ends with a single line a user can click.
 *
 * The drive id comes from `ctx.reactor()` (always populated by the
 * framework). The Connect URL comes from the live ServiceManager — the
 * runtime computes it locally but doesn't write it back to ReactorContext,
 * so reading it off the service instance is the only reliable source.
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
    if (!connectUrl) return;

    const base = connectUrl.replace(/\/+$/, "");
    // eslint-disable-next-line no-console
    console.log(`Vetra Studio: ${base}/d/${driveId}`);
  },

  async poll() {
    return null;
  },
});
