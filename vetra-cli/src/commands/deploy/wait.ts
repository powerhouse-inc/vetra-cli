import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { findMyEnvironment } from "../../cloud/environments-read.js";
import { describeEnvironmentSummary, resolveEnvironment } from "./_helpers.js";

// Statuses that mean a deploy is still progressing; anything else is settled.
// Compared upper-cased, which also normalizes the model's DEPLOYMENt_FAILED typo.
const IN_FLIGHT = new Set([
  "CHANGES_PENDING",
  "CHANGES_APPROVED",
  "CHANGES_PUSHED",
  "DEPLOYING",
  "TERMINATING",
]);

const POLL_INTERVAL_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const deployEnvironmentWait = defineCommand({
  id: "deploy-environment-wait",
  description:
    "Wait for a Vetra Cloud environment to finish deploying. Polls every 5s and blocks until the status settles (READY, or a failure such as DEPLOYMENT_FAILED) or the timeout elapses — call this once after approving changes instead of polling deploy-environment-get in a loop. If it's still deploying at the timeout it returns the current status; call it again to keep waiting. Requires Renown authorization (check with whoami).",
  inputSchema: z.object({
    name: z
      .string()
      .default("")
      .describe(
        "Environment to wait on — accepts id, name, or subdomain (see deploy-environment-list).",
      ),
    timeout: z
      .number()
      .int()
      .min(5)
      .max(60)
      .default(30)
      .describe("Max seconds to block while polling (default 30, max 60). Polls every 5s."),
  }),
  execute: async (input, { workdir, config }) => {
    const ctx = { workdir, config };
    let env = await resolveEnvironment(ctx, input.name);
    const deadline = Date.now() + input.timeout * 1000;
    for (;;) {
      const status = (env.status ?? "").toUpperCase();
      if (!IN_FLIGHT.has(status)) {
        const verdict =
          status === "READY"
            ? "Deploy complete — environment is READY."
            : `Environment settled in ${env.status ?? "unknown"} (not READY).`;
        return { text: `${verdict}\n${describeEnvironmentSummary(env)}` };
      }
      if (Date.now() >= deadline) {
        return {
          text:
            `Still deploying after ${input.timeout}s (status ${env.status}). ` +
            `Call deploy-environment-wait again to keep waiting.\n` +
            describeEnvironmentSummary(env),
        };
      }
      await sleep(POLL_INTERVAL_MS);
      // Tolerate a transient miss (network blip / momentary absence): keep last-known.
      const next = await findMyEnvironment(ctx, env.id).catch(() => undefined);
      if (next) env = next;
    }
  },
});
