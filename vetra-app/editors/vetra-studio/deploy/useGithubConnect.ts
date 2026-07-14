import { useRenown } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "./cloudClient.js";
import {
  authorizeGithub,
  connectGithub,
  startGithubDeviceFlow,
  type GithubConnection,
} from "./githubConnect.js";

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_BACKOFF_SECONDS = 5;

/**
 * The visible state of the connect journey. Order: starting → awaiting
 * (device code) → waitingInstall (only when the app isn't installed;
 * auto-advances) → naming (repo name, the last step) → creating → connected.
 */
export type ConnectPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting"; userCode: string; verificationUri: string }
  | { kind: "waitingInstall" }
  | { kind: "naming"; error?: string }
  | { kind: "creating" }
  | { kind: "connected"; connection: GithubConnection }
  | { kind: "error"; message: string };

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const TERMINAL_MESSAGES: Record<string, string> = {
  expired: "The authorization code expired. Try again.",
  denied: "GitHub authorization was declined.",
  unauthenticated: "Your session expired. Sign in again.",
};

/**
 * Drives the connect journey for one environment. `start()` runs the device
 * flow and polls until the caller is authorized AND the app is installed
 * (surfacing waitingInstall in between — it advances by itself). `createRepo`
 * then completes with the repo name, reusing the token the backend cached for
 * this device code.
 */
export function useGithubConnect(environmentId: string) {
  const renown = useRenown();
  const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });
  const runRef = useRef(0);
  const deviceCodeRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      runRef.current += 1;
    };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const run = (runRef.current += 1);
    const alive = (): boolean => runRef.current === run;
    setPhase({ kind: "starting" });

    const startToken = await getAuthToken(renown);
    if (!startToken) {
      if (alive())
        setPhase({ kind: "error", message: "Not signed in with Renown." });
      return;
    }
    const flow = await startGithubDeviceFlow(startToken);
    if (!alive()) return;
    if (!flow) {
      setPhase({
        kind: "error",
        message: "Could not start GitHub authorization.",
      });
      return;
    }
    deviceCodeRef.current = flow.deviceCode;
    setPhase({
      kind: "awaiting",
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
    });

    let interval = flow.interval || DEFAULT_POLL_INTERVAL_SECONDS;
    const deadline = Date.now() + flow.expiresIn * 1000;
    while (alive() && Date.now() < deadline) {
      await sleep(interval);
      if (!alive()) return;
      const token = await getAuthToken(renown);
      if (!token) {
        setPhase({ kind: "error", message: "Not signed in with Renown." });
        return;
      }
      const result = await authorizeGithub(flow.deviceCode, token);
      if (!alive()) return;

      if (result.status === "authorized") {
        if (result.appInstalled) {
          setPhase({ kind: "naming" });
          return;
        }
        // Authorized but the app isn't installed — keep polling; the phase
        // advances by itself once the install appears.
        setPhase({ kind: "waitingInstall" });
        continue;
      }
      if (result.status === "pending") continue;
      if (result.status === "slowDown") {
        interval += SLOW_DOWN_BACKOFF_SECONDS;
        continue;
      }
      setPhase({
        kind: "error",
        message:
          result.status === "error"
            ? result.message
            : (TERMINAL_MESSAGES[result.status] ??
              "GitHub authorization failed."),
      });
      return;
    }
    if (alive()) {
      setPhase({
        kind: "error",
        message: "The authorization code expired. Try again.",
      });
    }
  }, [renown]);

  const createRepo = useCallback(
    async (repoName: string): Promise<void> => {
      const run = (runRef.current += 1);
      const alive = (): boolean => runRef.current === run;
      const deviceCode = deviceCodeRef.current;
      if (!deviceCode) {
        setPhase({ kind: "error", message: "The authorization expired. Try again." });
        return;
      }
      setPhase({ kind: "creating" });

      const token = await getAuthToken(renown);
      if (!token) {
        if (alive())
          setPhase({ kind: "error", message: "Not signed in with Renown." });
        return;
      }
      const result = await connectGithub(
        deviceCode,
        repoName,
        environmentId,
        token,
      );
      if (!alive()) return;

      if (result.status === "connected") {
        if (result.connection) {
          setPhase({ kind: "connected", connection: result.connection });
        } else {
          setPhase({
            kind: "error",
            message: "Connected, but no repository was returned.",
          });
        }
        return;
      }
      if (result.status === "repoExists") {
        setPhase({
          kind: "naming",
          error: `A repository named "${repoName}" already exists. Choose another name.`,
        });
        return;
      }
      if (result.status === "expired") {
        setPhase({
          kind: "error",
          message: "The authorization expired. Try again.",
        });
        return;
      }
      setPhase({
        kind: "naming",
        error:
          result.status === "error"
            ? result.message
            : (TERMINAL_MESSAGES[result.status] ??
              "Repository creation failed. Try again."),
      });
    },
    [renown, environmentId],
  );

  const reset = useCallback(() => {
    runRef.current += 1;
    deviceCodeRef.current = null;
    setPhase({ kind: "idle" });
  }, []);

  return { phase, start, createRepo, reset };
}
