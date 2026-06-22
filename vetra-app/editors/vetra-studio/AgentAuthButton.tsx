/**
 * "Authorize agent" control in the studio header.
 *
 * Two Renown identities exist: the user's wallet (on renown.id) and the agent's
 * own did:key (backend). This button authorizes the agent's did:key to act as
 * the user — it opens the renown.id console for that did:key, where the user
 * approves with their wallet, while the daemon polls to store the credential.
 * (An in-app one-click authorize isn't possible: the wallet session and
 * credential publishing live on the renown.id origin.)
 *
 * States: not authorized → "Authorize agent"; awaiting approval → "Authorizing…"
 * (reopens the console on click); authorized → a "✓ Renown 0x…" chip with
 * Disconnect.
 */
import { useEffect, useRef, useState } from "react";
import {
  confirmAuth,
  fetchAuthStatus,
  logoutAuth,
  startAuth,
  type AuthState,
} from "./hooks/preview-server-client.js";

function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function AgentAuthButton() {
  const [state, setState] = useState<AuthState | null>(null);
  const [busy, setBusy] = useState(false);
  // Read inside the poll loop without restarting the effect on every update.
  const pendingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (next: AuthState) => {
      pendingRef.current = !next.authenticated && Boolean(next.pending);
      if (!signal.aborted) setState(next);
    };

    const loop = async () => {
      try {
        // While a login is pending, `confirm` advances it (and stores the
        // credential on approval); otherwise just read status.
        const next = pendingRef.current
          ? await confirmAuth({ waitMs: 8000, signal })
          : await fetchAuthStatus(signal);
        apply(next);
      } catch {
        // Aborted on unmount, or daemon momentarily unreachable.
      }
      if (signal.aborted) return;
      timer = setTimeout(() => void loop(), pendingRef.current ? 1000 : 4000);
    };

    void loop();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const apply = (next: AuthState) => {
    pendingRef.current = !next.authenticated && Boolean(next.pending);
    setState(next);
  };

  const authorize = async () => {
    if (busy) return;
    setBusy(true);
    // Open the tab inside the click gesture so it isn't popup-blocked, then
    // point it at the console URL once the daemon returns it.
    const popup = window.open("about:blank", "_blank");
    try {
      const next = await startAuth();
      apply(next);
      if (next.pending?.loginUrl) {
        if (popup) {
          popup.location.href = next.pending.loginUrl;
        } else {
          window.open(next.pending.loginUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        popup?.close();
      }
    } catch {
      popup?.close();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await logoutAuth());
    } catch {
      // ignore; next poll re-syncs
    } finally {
      setBusy(false);
    }
  };

  // Until the first status resolves, render nothing (avoids a flash).
  if (!state) return null;

  if (state.authenticated) {
    return (
      <span
        className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400"
        title={
          state.address
            ? `Authorized via Renown as ${state.address}`
            : "Authorized via Renown"
        }
      >
        <CheckIcon />
        <span className="text-vetra-muted-fg">Renown</span>
        <span className="font-mono">
          {state.address ? shortAddress(state.address) : "connected"}
        </span>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={busy}
          title="Sign out of Renown (revoke the agent's access)"
          className="ml-0.5 rounded px-1 text-vetra-muted-fg hover:text-vetra-fg disabled:opacity-50"
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
        className="flex items-center gap-1.5 rounded-md border border-vetra-border px-2 py-0.5 text-[11px] text-vetra-muted-fg hover:bg-vetra-accent disabled:opacity-50"
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
      className="flex items-center gap-1.5 rounded-md bg-vetra-primary px-2 py-0.5 text-[11px] font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
    >
      Authorize agent
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-vetra-muted-fg/40 border-t-vetra-primary"
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
