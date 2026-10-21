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

/**
 * How long a Renown console login stays usable (Renown drops its console
 * sessions after five minutes). An older pending login is treated as gone:
 * the next click starts a fresh one.
 */
export const RENOWN_LOGIN_LIFETIME_MS = 5 * 60 * 1000;

/** The daemon's pending login, unless it is older than the Renown lifetime.
 * The age is the daemon's own measure (`ageMs`), never this browser's clock;
 * a daemon that doesn't report it keeps its login as current. */
function currentLogin(
  state: AuthState | null,
): { loginUrl: string } | undefined {
  const pending = state?.pending;
  if (!pending || state.authenticated) return undefined;
  if (pending.ageMs !== undefined && pending.ageMs > RENOWN_LOGIN_LIFETIME_MS) {
    return undefined;
  }
  return pending;
}

export type AgentAuth = {
  /** Null until the first status poll resolves. */
  state: AuthState | null;
  /** An authorize/disconnect call is in flight. */
  busy: boolean;
  authenticated: boolean;
  /** A console login is awaiting browser approval (and is still usable). */
  pending: boolean;
  /** Start (or reopen) the renown.id console login for the agent. */
  authorize: () => Promise<void>;
  /**
   * Open the pending console login again (its tab was closed or lost); starts
   * a fresh login when there is none, or it is older than the Renown lifetime.
   */
  reopen: () => Promise<void>;
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
      pendingRef.current = Boolean(currentLogin(next));
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
    pendingRef.current = Boolean(currentLogin(next));
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

  const reopen = async () => {
    const login = currentLogin(state);
    if (!login) return authorize();
    // Inside the click gesture, like `authorize`, so it isn't popup-blocked.
    window.open(login.loginUrl, "_blank", "noopener,noreferrer");
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
    pending: Boolean(currentLogin(state)),
    authorize,
    reopen,
    disconnect,
  };
}
