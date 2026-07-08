/**
 * Agent Renown authorization state + actions, shared by the studio header
 * button and the deploy flow.
 *
 * Two Renown identities exist: the user's wallet (on renown.id) and the agent's
 * own did:key (backend). `authorize` starts delegating the user's identity to
 * the agent's did:key — it opens the renown.id console for that did:key, where
 * the user approves with their wallet, while the daemon polls to store the
 * credential. (An in-app one-click authorize isn't possible: the wallet session
 * and credential publishing live on the renown.id origin.)
 */
import { useEffect, useRef, useState } from "react";
import {
  confirmAuth,
  fetchAuthStatus,
  logoutAuth,
  startAuth,
  type AuthState,
} from "./preview-server-client.js";

export type AgentAuth = {
  /** Null until the first status poll resolves. */
  state: AuthState | null;
  /** An authorize/disconnect call is in flight. */
  busy: boolean;
  authenticated: boolean;
  /** A console login is awaiting browser approval. */
  pending: boolean;
  /** Start (or reopen) the renown.id console login for the agent. */
  authorize: () => Promise<void>;
  /** Clear the stored credential (the agent's keypair/DID is kept). */
  disconnect: () => Promise<void>;
};

export function useAgentAuth(): AgentAuth {
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

  return {
    state,
    busy,
    authenticated: state?.authenticated ?? false,
    pending: Boolean(state?.pending) && !state?.authenticated,
    authorize,
    disconnect,
  };
}
