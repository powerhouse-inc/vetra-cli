// Caps the noisy ph-clint startup banner with one prominent Vetra Studio line,
// and opens it in the browser on an interactive local run (stdout is a TTY).
import { spawn } from "node:child_process";
import { defineTrigger } from "../framework.js";

const STUDIO_SERVICE_NAME = "vetra-studio";

// Launch the OS default browser, detached and best-effort. A missing opener
// arrives async as an 'error' event (spawn won't throw), so swallow that too.
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* opener unavailable — the printed URL stands */
  }
}

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

    const url = `${studioUrl.replace(/\/+$/, "")}/d/${driveId}`;

    // Non-TTY (CI, lab scripts, pods): emit the exact `Vetra Studio: <url>` line
    // that automated consumers grep for readiness. Keep it byte-stable.
    if (!process.stdout.isTTY) {
      console.log(`Vetra Studio: ${url}`);
      return;
    }

    // Interactive terminal: a prominent, colored call-to-action, then open it.
    const paint = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`;
    console.log(
      `\n  ${paint("1;32", "▸ Opening Vetra Studio in your browser…")}\n    ${paint("1;36", url)}\n`,
    );
    openBrowser(url);
  },

  async poll() {
    return null;
  },
});
