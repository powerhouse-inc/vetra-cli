/**
 * Whether the visitor may start a build now (spec §5.3). A Studio running in
 * the cloud (its config names its own Studio id) needs a Renown sign-in
 * before Build it; a Studio running on the customer's own machine has no
 * sign-in step, so it counts as signed in.
 */
import { useRenownAuth } from "@powerhousedao/reactor-browser";
import { useEffect, useState } from "react";
import { resolveStudioEnvironmentId } from "../hooks/preview-server-client.js";

export type StudioSignInStatus = "checking" | "signed-in" | "signed-out";

export type StudioSignIn = {
  status: StudioSignInStatus;
  /** The signed-in person's name or short address, when there is one. */
  name: string | undefined;
  /** True when a Renown user is signed in (sign out is offered then). */
  hasUser: boolean;
  signIn: () => void;
  signOut: () => void;
};

type AuthStatus = ReturnType<typeof useRenownAuth>["status"];

/** The pure decision, kept apart from the hooks for tests. */
export function signInStatus(
  required: boolean | null,
  auth: AuthStatus,
): StudioSignInStatus {
  if (required === null) return "checking";
  if (!required) return "signed-in";
  if (auth === "authorized") return "signed-in";
  if (auth === "loading" || auth === "checking") return "checking";
  return "signed-out";
}

export function useStudioSignIn(): StudioSignIn {
  const auth = useRenownAuth();
  const [required, setRequired] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    resolveStudioEnvironmentId().then(
      (id) => {
        if (live) setRequired(id !== null);
      },
      () => {
        if (live) setRequired(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return {
    status: signInStatus(required, auth.status),
    name: auth.displayName ?? auth.displayAddress,
    hasUser: Boolean(auth.user),
    // Wrapped: login() takes an optional wallet session first.
    signIn: () => auth.login(),
    signOut: () => void auth.logout(),
  };
}
