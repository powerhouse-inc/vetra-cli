/**
 * "Authorize agent" control in the studio header. Auth state and the
 * renown.id console flow live in useAgentAuth (shared with the deploy flow).
 *
 * States: not authorized → "Authorize agent"; awaiting approval → "Authorizing…"
 * (reopens the console on click); authorized → a "✓ Renown 0x…" chip with
 * Disconnect.
 */
import { useAgentAuth } from "./hooks/useAgentAuth.js";

function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function AgentAuthButton() {
  const { state, busy, authorize, disconnect } = useAgentAuth();

  // Until the first status resolves, render nothing (avoids a flash).
  if (!state) return null;

  if (state.authenticated) {
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
          title="Sign out of Renown (revoke the agent's access)"
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
      title="Authorize the agent to act as you, using your Renown identity"
      className="flex items-center gap-1.5 rounded-md bg-vetra-primary px-2 py-0.5 text-[11px] font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 disabled:opacity-50"
    >
      Authorize agent
    </button>
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
