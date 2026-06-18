/**
 * Pins the `external-packages` cascade layer to the lowest priority in the
 * prebuilt Connect bundle.
 *
 * Connect's package manager mounts runtime-loaded package stylesheets as
 * `@import url(...) layer(external-packages)`. Cascade-layer priority follows
 * declaration order, so the layer must be declared before any other layer to
 * sit at the bottom. The bundled Connect CSS (current published version) does
 * not declare it, which makes the runtime mount the LAST declared layer —
 * i.e. the highest priority — letting a registry-served package stylesheet
 * override the app's own styles (preflight resets over utilities, stale
 * global theme overrides, etc.).
 *
 * This hook injects `<style>@layer external-packages;</style>` at the top of
 * the bundle's <head>, before any stylesheet, so the layer is declared first.
 * Idempotent; runs at startup so it survives `ph-cli connect build` rebuilds.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";

const LAYER_STYLE = "<style>@layer external-packages;</style>";

interface ConnectLayerOrderOptions {
  /** Path to the vetra-app package root. */
  vetraAppDir: string;
  /** Relative path to the prebuilt Connect bundle. Defaults to "dist/connect". */
  connectDir?: string;
}

export function connectExternalPackagesLayerOrder(
  options: ConnectLayerOrderOptions,
): LifecycleHook {
  const connectDir = options.connectDir ?? "dist/connect";

  return {
    name: "connect-layer-order",
    onInit(ctx) {
      const indexFile = path.join(
        options.vetraAppDir,
        connectDir,
        "index.html",
      );
      try {
        if (!existsSync(indexFile)) {
          ctx.log.warn(
            `[connect-layer-order] ${indexFile} not found; skipping.`,
          );
          return {};
        }
        const html = readFileSync(indexFile, "utf8");
        if (html.includes(LAYER_STYLE)) {
          ctx.log.debug(
            "[connect-layer-order] external-packages layer already pinned.",
          );
          return {};
        }
        const headOpen = html.indexOf("<head>");
        if (headOpen === -1) {
          ctx.log.warn(
            `[connect-layer-order] No <head> in ${indexFile}; skipping.`,
          );
          return {};
        }
        const insertAt = headOpen + "<head>".length;
        writeFileSync(
          indexFile,
          html.slice(0, insertAt) + LAYER_STYLE + html.slice(insertAt),
        );
        ctx.log.debug(
          "[connect-layer-order] Pinned external-packages as the lowest cascade layer.",
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.error(`[connect-layer-order] ${message}`);
      }
      return {};
    },
  };
}
