/**
 * Console login flow, split into a non-blocking start and a bounded poll.
 *
 * The SDK's `browserLogin` blocks until the user approves, which would stall
 * the agent loop for minutes. We split it: `startLogin` builds the Renown
 * approval URL immediately (opened by the studio "Authorize agent" button), and
 * `pollLogin` advances it in bounded slices, storing the credential via
 * `renown.login` on approval.
 */
import { type IRenown, type User } from "@renown/sdk/node";

const POLL_INTERVAL_MS = 2000;

export interface StartedLogin {
  url: string;
  sessionId: string;
}

interface ReadySessionResponse {
  sessionId: string;
  status: "ready";
  address: string;
  chainId: number;
  did: string;
  credentialId: string;
  userDocumentId: string;
}
interface PendingSessionResponse {
  sessionId: string;
  status: "pending";
}
type SessionResponse = ReadySessionResponse | PendingSessionResponse;

export type PollResult = { status: "ready"; user: User } | { status: "pending" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the Renown console URL for the agent's DID and a fresh session id. The
 * user opens it from the studio "Authorize agent" button; this never blocks or
 * opens a browser on the host (useless for a remote/deployed agent). */
export function startLogin(renown: IRenown): StartedLogin {
  const sessionId = crypto.randomUUID();
  const loginUrl = new URL("/console", renown.baseUrl);
  loginUrl.searchParams.set("session", sessionId);
  loginUrl.searchParams.set("connect", renown.did);
  loginUrl.searchParams.set("app", renown.did);
  return { url: loginUrl.toString(), sessionId };
}

/** Poll the console session up to `timeoutMs`; on ready, validate + store the
 * credential via `renown.login`. Returns `pending` if the window elapses. */
export async function pollLogin(
  renown: IRenown,
  sessionId: string,
  timeoutMs: number,
): Promise<PollResult> {
  const sessionUrl = new URL(
    `/api/console/session/${sessionId}`,
    renown.baseUrl,
  ).toString();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(sessionUrl);
      if (res.ok) {
        const data = (await res.json()) as SessionResponse;
        if (data.status === "ready") {
          const user = await renown.login(data.did);
          return { status: "ready", user };
        }
      }
    } catch {
      // Network blip; retry until the deadline.
    }
    if (Date.now() >= deadline) return { status: "pending" };
    await sleep(POLL_INTERVAL_MS);
  }
}
