import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { getAuthState } from "../../auth/renown.js";
import { resolveCloudConfig } from "../../cloud/config.js";

export const whoami = defineCommand({
  id: "whoami",
  description:
    "Check whether you (the agent) are authorized to act as the user via their Renown identity. Renown is the identity/auth provider — the same authorization lets you act as the user across Vetra Cloud and other Renown-protected services. Read-only — you cannot sign in yourself. If not authorized, tell the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry.",
  inputSchema: z.object({}),
  execute: async (_input, { workdir, config }) => {
    const { renownUrl } = resolveCloudConfig(config);
    const state = await getAuthState(workdir, renownUrl);
    if (state.authenticated) {
      return {
        text: `Authorized to act as the user via Renown (${state.address}).`,
      };
    }
    return {
      text: "Not authorized — the user hasn't connected their Renown identity to you yet. Ask the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry. There is no sign-in tool — you cannot authorize yourself.",
    };
  },
});
