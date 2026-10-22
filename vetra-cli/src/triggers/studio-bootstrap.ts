/**
 * Studio bootstrap trigger (Task 5.SIG, ruling X39) — first-run creation order.
 *
 * A new cloud Studio creates its drive `v2-required`, which needs a signature
 * and therefore the owner's delegation. When the daemon boots before the agent
 * has been authorized, `buildDefaultReactor` cannot create the drive and starts
 * without one (`DriveConfig.canCreate`). This trigger creates it the moment
 * writes become possible (`powerhouse:writes:ready`), records the pointer so
 * the Studio is sticky, and points the Connect bundle at the new drive. Until
 * then nothing is written: the agent's client refuses unsigned writes, and the
 * chat watch holds turns.
 */
import { ensureDrive } from "@powerhousedao/ph-clint/powerhouse";
import { defineTrigger } from "../framework.js";
import type { Config } from "../framework.js";
import { planStudioSigning } from "../auth/studio-mode.js";
import { cloudStudioDriveConfig } from "../auth/reactor-signing.js";
import {
  resolveStudioRenownUrl,
  stampStudioDrive,
} from "../lifecycle/connect-drive-url.js";

export interface StudioBootstrapOptions {
  /** Path to the vetra-app package root (the Connect bundle lives under it). */
  vetraAppDir: string;
  /** Relative path to the prebuilt Connect bundle. Defaults to "dist/connect". */
  connectDir?: string;
}

/** The browser-facing drive URL through the proxy, else the switchboard's. */
function driveUrlFor(
  driveId: string,
  switchboardUrl: string | undefined,
  proxyUrl: string | undefined,
): string | undefined {
  if (proxyUrl) return `${proxyUrl.replace(/\/+$/, "")}/switchboard/d/${driveId}`;
  if (!switchboardUrl) return undefined;
  try {
    return `${new URL(switchboardUrl).origin}/d/${driveId}`;
  } catch {
    return undefined;
  }
}

export function studioBootstrapTrigger(options: StudioBootstrapOptions) {
  const connectDir = options.connectDir ?? "dist/connect";

  return defineTrigger({
    id: "studio-bootstrap",
    type: "condition",

    async setup(ctx) {
      const config = ctx.context.config as Config;
      const workdir = ctx.context.workdir;
      const log = ctx.context.log;
      if (planStudioSigning(workdir, config).mode !== "v2-required") return;

      const reactor = await ctx.reactor();
      const module = reactor?._module;
      if (!reactor || !module) return;
      const ready = () => Boolean(reactor.writes?.ready());
      const renownUrl = resolveStudioRenownUrl(
        process.env.RENOWN_URL,
        config.cloudRenownUrl,
        { warn: (m) => log?.warn?.(m) },
      );

      let running = false;
      const ensure = async (): Promise<void> => {
        if (running || reactor.driveId || !ready()) return;
        running = true;
        try {
          const drive = await ensureDrive(
            { client: reactor.client, reactor: module.reactor } as never,
            cloudStudioDriveConfig(workdir, {
              preferredEditor: "vetra-studio",
              canCreate: ready,
            }),
          );
          if (!drive.id) return;
          reactor.driveId = drive.id;
          reactor.personalDriveId = drive.id;
          reactor.drives = [
            ...(reactor.drives ?? []).filter((d) => d.id !== drive.id),
            { id: drive.id, name: drive.name, role: "personal" as const },
          ];
          const driveUrl = driveUrlFor(
            drive.id,
            reactor.switchboardUrl,
            ctx.commandContext.proxy?.url,
          );
          if (driveUrl) {
            try {
              stampStudioDrive(
                options.vetraAppDir,
                driveUrl,
                renownUrl,
                connectDir,
                log ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
              );
            } catch (err: unknown) {
              log?.warn?.(
                `[studio-bootstrap] could not stamp the drive URL: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            const publicUrl = ctx.commandContext.proxy?.url ?? driveUrl;
            console.log(`Vetra Studio: ${publicUrl.replace(/\/+$/, "")}/d/${drive.id}`);
          }
          log?.info?.(
            `[studio-bootstrap] created the Studio drive ${drive.id} v2-required; the Studio is ready. Reload the browser.`,
          );
        } catch (err: unknown) {
          log?.warn?.(
            `[studio-bootstrap] drive creation did not complete yet: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          running = false;
        }
      };

      // Already authorized (most launched Studios): create it now.
      await ensure();
      ctx.commandContext.on?.("powerhouse:writes:ready", () => {
        void ensure();
      });
    },

    async poll() {
      return null;
    },
  });
}
