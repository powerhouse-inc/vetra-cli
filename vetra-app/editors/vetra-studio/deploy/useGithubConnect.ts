import { useRenown } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "./cloudClient.js";
import {
  connectGithub,
  startGithubDeviceFlow,
  type GithubConnection,
} from "./githubConnect.js";

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_BACKOFF_SECONDS = 5;

/** The visible state of the device-flow connect for one environment. */
export type ConnectPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting"; userCode: string; verificationUri: string }
  | { kind: "needsInstall" }
  | { kind: "connected"; connection: GithubConnection }
  | { kind: "error"; message: string };

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const TERMINAL_MESSAGES: Record<string, string> = {
  expired: "The authorization code expired. Try again.",
  denied: "GitHub authorization was declined.",
  unauthenticated: "Your session expired. Sign in again.",
};

/** Drives the device-flow connect for one environment: starts the flow,
 * exposes the user code, and polls until the backend reports the repo was
 * created or a terminal status. */
export function useGithubConnect(environmentId: string) {
  const renown = useRenown();
  const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });
  const runRef = useRef(0);

  useEffect(() => {
    return () => {
      runRef.current += 1;
    };
  }, []);

  const connect = useCallback(
    async (repoName: string): Promise<void> => {
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
        const result = await connectGithub(
          flow.deviceCode,
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
        if (result.status === "pending") continue;
        if (result.status === "slowDown") {
          interval += SLOW_DOWN_BACKOFF_SECONDS;
          continue;
        }
        if (result.status === "repoExists") {
          setPhase({
            kind: "error",
            message: `A repository named "${repoName}" already exists. Choose another name.`,
          });
          return;
        }
        if (result.status === "appNotInstalled") {
          // Keep polling: the backend holds the exchanged token in memory and
          // completes the connect on the first poll after the app is installed.
          setPhase({ kind: "needsInstall" });
          continue;
        }
        setPhase({
          kind: "error",
          message:
            result.status === "error"
              ? result.message
              : (TERMINAL_MESSAGES[result.status] ??
                "GitHub connection failed."),
        });
        return;
      }
      if (alive()) {
        setPhase({
          kind: "error",
          message: "The authorization code expired. Try again.",
        });
      }
    },
    [renown, environmentId],
  );

  const reset = useCallback(() => {
    runRef.current += 1;
    setPhase({ kind: "idle" });
  }, []);

  return { phase, connect, reset };
}
