import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, jest } from "@jest/globals";
import type { Action } from "@powerhousedao/shared/document-model";

import {
  createTeamRoutes,
  RELAY_ACTION_TYPES,
  type TeamRouteCall,
} from "../../src/preview-server/team-routes.js";
import type { VerifyResult } from "../../src/team/trust.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const DOC = "thread-doc";

function member(role: "owner" | "maker" | "viewer" | "guest", extra: Record<string, unknown> = {}) {
  return { address: OWNER, name: "Ada", role, reviewer: false, ...extra };
}

function call(
  method: string,
  url: string,
  body: unknown,
  m: ReturnType<typeof member>,
): { call: TeamRouteCall; out: { status: number; body: string } } {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(chunk?: string) {
      out.body = String(chunk ?? "");
    },
  } as unknown as ServerResponse;
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  return {
    call: {
      req,
      res,
      url,
      method,
      check: { ok: true, via: "member", member: m },
    },
    out,
  };
}

function action(type: string, signer: string): Action {
  return {
    id: `a-${type}-${signer}`,
    type,
    scope: "global",
    timestampUtcMs: "2026-10-21T10:00:00.000Z",
    input: {},
    context: { signer: { user: { address: signer, networkId: "eip155", chainId: 1 }, signatures: ["sig"] } },
  } as Action;
}

function routes(over: { verify?: VerifyResult } = {}) {
  const relay = jest.fn(async () => {});
  const verified = over.verify ?? { address: OWNER.toLowerCase(), appKey: "did:key:zAgent" };
  const verifyAction = jest.fn(async () => verified);
  const handle = createTeamRoutes({
    orgId: "acme",
    members: async () => [
      { address: OTHER, name: "Bo", role: "viewer", reviewer: true },
    ],
    hasDelegation: async () => false,
    verifyAction,
    relay,
  });
  return { handle, relay, verifyAction };
}

describe("team routes", () => {
  it("GET /team/me returns the member, the org and needsAllow for makers", async () => {
    const { handle } = routes();
    const { call: c, out } = call("GET", "/team/me", undefined, member("maker"));
    await handle.handle(c);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ member: member("maker"), orgId: "acme", needsAllow: true });
  });

  it("GET /team/members adds the caller to the accepted reviewers", async () => {
    const { handle } = routes();
    const { call: c, out } = call("GET", "/team/members", undefined, member("owner"));
    await handle.handle(c);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { members: { address: string }[] };
    expect(body.members.map((m) => m.address)).toEqual([OTHER, OWNER]);
  });

  it("POST /team/relay appends the caller's signed action unchanged", async () => {
    const { handle, relay, verifyAction } = routes();
    const add = action("ADD_COMMENT", OWNER);
    const { call: c, out } = call("POST", "/team/relay?changeId=c1", { documentId: DOC, actions: [add] }, member("viewer"));
    await handle.handle(c);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, appended: 1 });
    expect(verifyAction).toHaveBeenCalledWith(add, DOC);
    expect(relay).toHaveBeenCalledWith(DOC, [add]);
    expect((relay.mock.calls[0][1] as Action[])[0]).toEqual(add);
  });

  it("POST /team/relay refuses an action signed by someone else than the caller", async () => {
    const { handle, relay } = routes();
    const forged = action("ADD_COMMENT", OTHER);
    const { call: c, out } = call("POST", "/team/relay", { documentId: DOC, actions: [forged] }, member("viewer"));
    await handle.handle(c);
    expect(out.status).toBe(403);
    expect(relay).not.toHaveBeenCalled();
  });

  it("POST /team/relay refuses an action type outside the allowlist", async () => {
    const { handle, relay, verifyAction } = routes();
    const op = action("SET_REVIEW_REQUIRED", OWNER);
    const { call: c, out } = call("POST", "/team/relay", { documentId: DOC, actions: [op] }, member("viewer"));
    await handle.handle(c);
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toEqual({ error: "action-type-not-allowed" });
    expect(verifyAction).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
    expect(RELAY_ACTION_TYPES.SET_REVIEW_REQUIRED).toBeUndefined();
  });

  it("POST /team/relay refuses a steer action until 3.2 can check the change owner", async () => {
    const { handle, relay } = routes();
    const tag = action("TAG_REQUEST", OWNER);
    const { call: c, out } = call(
      "POST",
      "/team/relay",
      { documentId: DOC, actions: [tag], changeId: "c1", changeOwner: OTHER },
      member("viewer"),
    );
    await handle.handle(c);
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toEqual({ error: "action-type-not-allowed" });
    expect(relay).not.toHaveBeenCalled();
  });

  it("POST /team/relay refuses an action whose signature/delegation does not verify", async () => {
    const { handle, relay } = routes({ verify: { refused: "NOT_DELEGATED" } });
    const add = action("ADD_COMMENT", OWNER);
    const { call: c, out } = call("POST", "/team/relay", { documentId: DOC, actions: [add] }, member("viewer"));
    await handle.handle(c);
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toEqual({ error: "NOT_DELEGATED" });
    expect(relay).not.toHaveBeenCalled();
  });

  it("POST /team/relay rejects a malformed body", async () => {
    const { handle } = routes();
    const { call: c, out } = call("POST", "/team/relay", { actions: [] }, member("viewer"));
    await handle.handle(c);
    expect(out.status).toBe(400);
  });
});
