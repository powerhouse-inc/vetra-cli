/**
 * Always-on studio routing for a deployed vetra agent. Once the proxy and
 * reactor are up, registers two proxy routes unconditionally:
 *
 *   - a root redirect `/` → `/d/<driveId>` so the bare proxy origin lands on
 *     the studio drive (an exact route, so `/assets/*` and `/d/<id>` still
 *     reach Connect's `/` catch-all);
 *   - an announce route for `/d/<driveId>` → Connect (the same upstream as the
 *     `/` catch-all), so the route table advertises the drive as a runtime
 *     endpoint (vetra.io surfaces it as a clickable studio link) and `/d/<id>`
 *     keeps serving Connect rather than bouncing to switchboard.
 *
 * No config flag — this is the fixed behavior for vetra. ph-clint provides
 * the generic redirect/addRoute capability; this trigger always uses it.
 */
import { defineTrigger } from "../framework.js";

export const studioRedirectTrigger = defineTrigger({
  id: "studio-redirect",
  type: "condition",

  async setup(ctx) {
    const reactor = await ctx.reactor();
    const driveId = reactor?.personalDriveId ?? reactor?.driveId;
    const proxy = ctx.commandContext.proxy;
    if (!driveId || !proxy) return;

    const drivePrefix = `/d/${driveId}`;

    // Connect serves the studio drive at /d/<id> through its "/" catch-all.
    // The announce route must target that same upstream, or /d/<id> bounces to
    // switchboard and the browser ends up on /switchboard/d/<id>. Without it
    // there is no valid upstream — registering against the proxy's own URL
    // would self-proxy — so skip route registration entirely.
    const connectUpstream = proxy
      .routes()
      .find((r) => r.prefix === "/" && r.upstream)?.upstream;
    if (!connectUpstream) {
      console.warn(
        "studio-redirect: no Connect '/' upstream on the proxy; skipping studio routes",
      );
      return;
    }

    proxy.addRoute({
      prefix: "/",
      exact: true,
      redirectTo: drivePrefix,
      ws: false,
      source: "studio-redirect",
    });

    proxy.addRoute({
      prefix: drivePrefix,
      upstream: new URL(drivePrefix, String(connectUpstream)),
      ws: false,
      source: "studio-announce",
    });
  },

  async poll() {
    return null;
  },
});
