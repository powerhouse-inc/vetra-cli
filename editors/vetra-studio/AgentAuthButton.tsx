/**
 * "Authorize agent" control in Settings. Auth state and the renown.id console
 * flow live in useAgentAuth (shared with the deploy flow and the sign-in
 * publishing modal, D7).
 *
 * States: not authorized (or withdrawn) → "Authorize agent"; awaiting
 * approval → "Authorizing…" (reopens the console on click); approved by a
 * Renown wallet → a "✓ Renown 0x…" chip with Disconnect; acting as the user's
 * pseudonym (a local Studio, nobody logged in) → "Agent acts as Anonymous
 * 0x…" with Withdraw; that pseudonym locked with a password → a password
 * field that unlocks it at the server serving this tab.
 */
import { useRenown } from "@powerhousedao/reactor-browser";
import { useState } from "react";
import { unlockAgent } from "./hooks/unlock-agent.js";
import { useAgentAuth } from "./hooks/useAgentAuth.js";

function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function AgentAuthButton() {
  const { state, busy, authenticated, pseudonym, authorize, disconnect } =
    useAgentAuth();

  // Until the first status resolves, render nothing (avoids a flash).
  if (!state) return null;

  if (state.locked) return <LockedAgent />;

  if (pseudonym) {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        title="The agent signs its changes with its own key, as your pseudonym. Vetra Cloud needs a Renown login."
      >
        <span>
          Agent acts as{" "}
          <span className="font-mono">{state.who ?? "your pseudonym"}</span>
        </span>
        {state.recorded ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            title="Withdraw the agent's credential: it can no longer change anything here"
            className="ml-0.5 rounded px-1 hover:text-foreground disabled:opacity-50"
          >
            Withdraw
          </button>
        ) : null}
      </span>
    );
  }

  if (authenticated) {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] text-success"
        title={
          state.address
            ? `Authorized via Renown as ${state.address}`
            : "Authorized via Renown"
        }
      >
        <CheckIcon />
        <span className="text-muted-foreground">Renown</span>
        <span className="font-mono">
          {state.address ? shortAddress(state.address) : "connected"}
        </span>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={busy}
          title="Withdraw the agent's approval: it can no longer act as you"
          className="ml-0.5 rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Disconnect
        </button>
      </span>
    );
  }

  if (state.pending) {
    return (
      <button
        type="button"
        onClick={() => void authorize()}
        disabled={busy}
        title="Approve in the Renown tab, or click to reopen"
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        <Spinner />
        Authorizing…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void authorize()}
      disabled={busy}
      title={
        state.withdrawn
          ? "Let the agent act as you again"
          : "Authorize the agent to act as you, using your Renown identity"
      }
      className="flex items-center gap-1.5 rounded-md bg-vetra-primary px-2 py-0.5 text-[11px] font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 disabled:opacity-50"
    >
      Authorize agent
    </button>
  );
}

/**
 * The agent's credential is issued by the user's pseudonym, whose key is
 * locked with a password: the password, sent to the server that serves this
 * tab, unlocks it there (F3d). The next status poll shows the agent signing.
 */
function LockedAgent() {
  const renown = useRenown();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const unlock = async () => {
    if (busy || !password) return;
    setBusy(true);
    const result = await unlockAgent({
      password,
      bearer: async () =>
        renown?.user ? renown.getBearerToken({ expiresIn: 60 }) : undefined,
      // Safe access: package builds may lack import.meta.env.
      base: (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL,
    });
    setBusy(false);
    setPassword("");
    setMessage(result.ok ? "Unlocked: the agent signs again." : result.message);
  };

  return (
    <form
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title="The agent's credential is issued by your pseudonym, whose key is locked with a password."
      onSubmit={(event) => {
        event.preventDefault();
        void unlock();
      }}
    >
      <span>Agent can't sign: your pseudonym is locked</span>
      <input
        type="password"
        autoComplete="current-password"
        aria-label="Password of your pseudonym"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="w-24 rounded border border-border bg-transparent px-1 py-0.5"
      />
      <button
        type="submit"
        disabled={busy || !password}
        className="rounded px-1 hover:text-foreground disabled:opacity-50"
      >
        Unlock
      </button>
      {message ? <span role="status">{message}</span> : null}
    </form>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-vetra-primary"
    />
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="h-3.5 w-3.5">
      <path
        d="m3.5 8.5 3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
