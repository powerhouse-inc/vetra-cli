import { identityDataDir, readActiveIdentity } from "@powerhousedao/shared/clis/identity";
import { readAgentStatus, type AgentStatus } from "../../auth/agent-files.js";
import { defineCommand } from "../../framework.js";
import { whoamiMeta } from "./meta.js";

const AUTHORIZE =
  "Ask the user to click 'Authorize agent' in the top bar of Vetra Studio (next to Auto-follow agent) and approve in their wallet, then retry. There is no sign-in tool — you cannot authorize yourself.";

/** The agent's session, from its files: no Renown, no network. */
function agentLines(status: AgentStatus): string[] {
  const session = `Your session "${status.session}"${status.key ? ` (${status.key})` : ""}`;
  const until = status.expiresAt ? `, its credential valid until ${status.expiresAt}` : "";
  const record = status.recorded ? "; this store holds its record" : "";
  if (status.kind === "pseudonym") {
    if (status.locked) {
      return [
        `${session} cannot sign: the key of the user's pseudonym, ${status.who}, is locked with a password and the Studio has no terminal to ask it on. Ask the user to set PH_IDENTITY_PASSWORD where the Studio runs.`,
      ];
    }
    if (status.withdrawn) {
      return [`${session} was withdrawn in this store: you cannot write. ${AUTHORIZE}`];
    }
    return [
      status.address
        ? `${session} acts for the user's pseudonym, ${status.who}${until}${record}. You may write here; Vetra Cloud needs a Renown approval.`
        : `${session} acts for the user's pseudonym, made at your first write. You may write here; Vetra Cloud needs a Renown approval.`,
    ];
  }
  if (status.authorized) {
    return [
      `${session} is authorized via Renown to act as ${status.address}${until}${record}, here and across Vetra Cloud and other Renown-protected services.`,
    ];
  }
  return [
    status.withdrawn
      ? `${session} was withdrawn in this store: you cannot write. ${AUTHORIZE}`
      : `Not authorized — the user hasn't approved your session with their Renown wallet yet, so you cannot write. ${AUTHORIZE}`,
  ];
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
    const lines = [...agentLines(readAgentStatus(workdir)), personLine(workdir)];
    return Promise.resolve({ text: lines.join("\n") });
  },
});
