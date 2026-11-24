import { readFileSync } from "node:fs";
import {
  identityDataDir,
  readActiveIdentity,
} from "@powerhousedao/shared/clis/identity";
import { defineCommand } from "../../framework.js";
import { isAdminAddress, requireAdminIdentity } from "../../auth/owner-rule.js";
import { studioPath } from "../../helpers/studio-paths.js";
import { whoamiMeta } from "./meta.js";

/** The agent's delegated credential, read from its file: no Renown, no network. */
function agentAddress(workdir: string): string | undefined {
  let user:
    | { address?: string; credential?: { expirationDate?: string } }
    | undefined;
  try {
    user = (
      JSON.parse(readFileSync(studioPath(workdir, "agentRenown"), "utf8")) as {
        user?: typeof user;
      }
    ).user;
  } catch {
    return undefined;
  }
  if (!user?.address || !user.credential) return undefined;
  const expires = Date.parse(user.credential.expirationDate ?? "");
  if (Number.isFinite(expires) && expires <= Date.now()) return undefined;
  // A cloud Studio's agent holds only the owner's delegation (auth/renown.ts).
  if (requireAdminIdentity() && !isAdminAddress(user.address, process.env.ADMINS)) {
    return undefined;
  }
  return user.address;
}

/** Who acts on this computer when the user runs a command themselves. */
function personLine(workdir: string): string {
  const person = readActiveIdentity({ dataDir: identityDataDir(workdir) });
  if (!person) return "The user has no Renown login and no pseudonym on this computer yet.";
  if (person.kind === "renown") {
    return person.renown?.expired
      ? `The user's Renown login (${person.label}) has expired.`
      : `The user is logged in with Renown as ${person.label}.`;
  }
  return `The user has no Renown login; their pseudonym is ${person.label}.`;
}

export const whoami = defineCommand({
  ...whoamiMeta,
  execute: (_input, { workdir }) => {
    const address = agentAddress(workdir);
    const agent = address
      ? `Authorized to act as the user via Renown (${address}).`
      : "Not authorized — the user hasn't connected their Renown identity to you yet. Ask the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry. There is no sign-in tool — you cannot authorize yourself.";
    return Promise.resolve({ text: `${agent}\n${personLine(workdir)}` });
  },
});
