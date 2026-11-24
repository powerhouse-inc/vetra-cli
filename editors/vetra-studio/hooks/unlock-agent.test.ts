import { describe, expect, it, vi } from "vitest";
import { AGENT_SESSION, unlockAgent } from "./unlock-agent.js";

const ORIGIN = "http://127.0.0.1:8090";

function answering(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

describe("unlockAgent", () => {
  it("sends the password for the agent's session, with the tab's bearer, to its own server", async () => {
    const fetch = answering(200, { ok: true, sessions: [] });
    const result = await unlockAgent({
      password: "pw",
      bearer: () => Promise.resolve("tab.jwt"),
      origin: ORIGIN,
      fetch,
    });
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/__ph/unlock`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tab.jwt",
      },
      body: JSON.stringify({ password: "pw", sessions: [AGENT_SESSION] }),
    });
  });

  it("asks for the sign-in link first when the tab holds no sign-in", async () => {
    const fetch = answering(200, {});
    expect(
      await unlockAgent({
        password: "pw",
        bearer: () => Promise.resolve(undefined),
        origin: ORIGIN,
        fetch,
      }),
    ).toMatchObject({ ok: false, reason: "sign-in" });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await unlockAgent({
        password: "pw",
        bearer: () => Promise.resolve("tab.jwt"),
        origin: ORIGIN,
        fetch: answering(401, { reason: "not-issued-here" }),
      }),
    ).toMatchObject({ ok: false, reason: "sign-in" });
  });

  it("says a password was wrong, and a Renown login authorizes instead", async () => {
    const bearer = () => Promise.resolve("tab.jwt");
    expect(
      await unlockAgent({
        password: "no",
        bearer,
        origin: ORIGIN,
        fetch: answering(401, { reason: "wrong-password" }),
      }),
    ).toMatchObject({ ok: false, reason: "wrong-password" });
    expect(
      await unlockAgent({
        password: "pw",
        bearer,
        origin: ORIGIN,
        fetch: answering(409, { reason: "renown-login" }),
      }),
    ).toMatchObject({ ok: false, reason: "renown-login" });
  });
});
