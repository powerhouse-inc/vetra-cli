/** Id, description and input schema of the auth commands (see ../spec/meta.ts). */
import { z } from "zod";

export const whoamiMeta = {
  id: "whoami",
  description:
    "Check whom you (the agent) act for and whether you may write: your own session, labelled 'vetra agent vetra-agent', signs for the user's pseudonym or for the Renown wallet that approved it. Vetra Cloud and other Renown-protected services need the Renown approval. Read-only — you cannot authorize yourself. If not authorized, tell the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry.",
  inputSchema: z.object({}),
};
