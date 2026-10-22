/**
 * The Studio's team as the page knows it (P6 task 1.12): the caller's own
 * member record and the roster the daemon can vouch for.
 *
 * Failure is a state, not an error page: `unavailable` lets the page keep
 * today's Studio and say the team list isn't available (an older daemon
 * without team routes, a Renown outage, or a caller the gate refused).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Member } from "./capabilities.js";
import {
  fetchTeamMe,
  fetchTeamMembers,
  type TeamMember,
} from "./teamClient.js";

/** How often the roster re-reads (roles change on Owner actions/membership). */
export const TEAM_POLL_MS = 30_000;

export interface Team {
  me: Member | null;
  members: TeamMember[];
  orgId: string | null;
  loading: boolean;
  unavailable: boolean;
  /** The roster is the members this Studio has seen, not the org's full list. */
  limited: boolean;
  /** The caller may use the Studio but has not allowed its agent yet. */
  needsAllow: boolean;
  refresh: () => void;
}

const EMPTY: Omit<Team, "loading" | "unavailable" | "refresh"> = {
  me: null,
  members: [],
  orgId: null,
  limited: false,
  needsAllow: false,
};

export function useTeam(options: { pollMs?: number } = {}): Team {
  const pollMs = options.pollMs ?? TEAM_POLL_MS;
  const [state, setState] = useState<{
    data: typeof EMPTY;
    loading: boolean;
    unavailable: boolean;
  }>({ data: EMPTY, loading: true, unavailable: false });
  const [generation, setGeneration] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const load = async () => {
      try {
        const [me, roster] = await Promise.all([
          fetchTeamMe(signal),
          fetchTeamMembers(signal),
        ]);
        if (signal.aborted) return;
        setState({
          data: {
            me: me.member,
            members: roster.members,
            orgId: roster.orgId ?? me.orgId,
            limited: roster.limited,
            needsAllow: me.needsAllow,
          },
          loading: false,
          unavailable: false,
        });
      } catch {
        if (signal.aborted) return;
        // The team list is unknown: the page keeps working (the server still
        // enforces every route), and the panel says why it is empty.
        setState({ data: EMPTY, loading: false, unavailable: true });
      }
    };

    void load();
    const timer =
      pollMs > 0 ? setInterval(() => void load(), pollMs) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pollMs, generation]);

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  return {
    ...state.data,
    loading: state.loading,
    unavailable: state.unavailable,
    refresh,
  };
}
