/**
 * Who the Cli writes as on the Studio switchboard: its agent's session
 * (`auth/renown.ts`), in every Studio.
 *
 * The signer opens at the agent's first write (clint `LazySigner`), so a
 * Studio that writes nothing makes no pseudonym. Local, nobody logged in:
 * the pseudonym's session, issued then with no click. A Renown login, and a
 * cloud Studio: the session the person approved ("Authorize agent"); until
 * then every write is refused and the Studio shows the button. Each request
 * bears the agent's session once it has one, and the watch reconnects the
 * socket and emits `powerhouse:writes:ready` when the agent is authorized.
 *
 * Limit (clint `RemoteReactorConfig.signer`): while the agent is not
 * authorized every write is refused, a legacy one included, so a cloud
 * Studio writes no legacy document.
 */
import type { LazySigner } from "@powerhousedao/clint";
import { readAgentStatus } from "./agent-files.js";
import type * as AgentModule from "./renown.js";
import { isCloudStudio } from "./studio-mode.js";

/** The identity part of the Cli's `configureReactor.remote`. */
export interface StudioIdentity {
  signer: LazySigner;
  tokenProvider: () => Promise<string | undefined>;
  onSignerChange: (listener: () => void) => () => void;
  legacyDocuments: "refuse" | "sign-when-ready";
}

/** What the identity reads from clint's reactor setup context. */
export interface StudioIdentitySetup {
  workdir: string;
  config: Record<string, unknown>;
}

export interface StudioIdentityDeps {
  /** Tests: the agent's session module. */
  agent?: Pick<typeof AgentModule, "openAgentSession" | "getAgentBearer" | "onAgentChange">;
  env?: NodeJS.ProcessEnv;
}

/** The agent's identity on the Studio switchboard. */
export async function studioIdentity(
  setup: StudioIdentitySetup,
  deps: StudioIdentityDeps = {},
): Promise<StudioIdentity> {
  const cloud = isCloudStudio(setup.config, deps.env);
  const agent = deps.agent ?? (await import("./renown.js"));
  const env = deps.env ?? process.env;
  return {
    signer: {
      ready: () => readAgentStatus(setup.workdir, { cloud, env }).authorized,
      open: async () =>
        (await agent.openAgentSession(setup.workdir, { cloud })).actionSigner,
    },
    tokenProvider: () => agent.getAgentBearer(setup.workdir),
    onSignerChange: (listener) => agent.onAgentChange(setup.workdir, listener),
    legacyDocuments: cloud ? "refuse" : "sign-when-ready",
  };
}
