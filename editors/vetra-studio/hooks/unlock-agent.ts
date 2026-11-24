/**
 * Unlocks the agent from the Studio tab (F3d): the agent's credential is
 * issued by the user's pseudonym, whose key is locked with a password the
 * Studio has no terminal to ask for. The tab sends the password to the
 * sign-in endpoint of the server that serves it (loopback only), with a
 * bearer of its own session, signed in by the link `ph vetra` prints. The
 * server unlocks the key in its memory and issues the agent's credential.
 */

/** The agent's session, as the Studio's connect host declares it. */
export const AGENT_SESSION = "vetra agent vetra-agent";

export type UnlockResult =
  | { ok: true }
  | {
      ok: false;
      /** `sign-in`: the tab holds no sign-in of this computer's yet. */
      reason: "sign-in" | "wrong-password" | "renown-login" | "failed";
      message: string;
    };

const SIGN_IN_FIRST =
  "Open the sign-in link `ph vetra` printed in its terminal, then unlock here.";

export async function unlockAgent(o: {
  password: string;
  /** A bearer of the tab's session; undefined while it holds no sign-in. */
  bearer: () => Promise<string | undefined>;
  /** The app's base URL (`/` for the Studio). */
  base?: string;
  origin?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<UnlockResult> {
  const bearer = await o.bearer().catch(() => undefined);
  if (!bearer) return { ok: false, reason: "sign-in", message: SIGN_IN_FIRST };
  const base = (o.base ?? "/").replace(/\/?$/, "/");
  const url = `${o.origin ?? window.location.origin}${base}__ph/unlock`;
  let response: Response;
  try {
    response = await (o.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ password: o.password, sessions: [AGENT_SESSION] }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: `The Studio could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { reason?: string };
  switch (body.reason) {
    case "wrong-password":
      return {
        ok: false,
        reason: "wrong-password",
        message: "That password does not unlock the key.",
      };
    case "renown-login":
      return {
        ok: false,
        reason: "renown-login",
        message:
          "You are logged in with Renown here: authorize the agent instead.",
      };
    case "bad-bearer":
    case "not-issued-here":
    case "withdrawn":
    case "expired":
      return { ok: false, reason: "sign-in", message: SIGN_IN_FIRST };
    default:
      return {
        ok: false,
        reason: "failed",
        message: `The Studio refused to unlock (${body.reason ?? `HTTP ${response.status}`}).`,
      };
  }
}
