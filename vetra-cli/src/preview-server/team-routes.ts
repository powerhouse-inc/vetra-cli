/**
 * Team routes for the preview server (P6-3, P6-12). Every route is behind the
 * member capability gate in request-auth.ts; this module only checks what is
 * specific to the route:
 *
 *   GET  /team/me       the caller's member record, org and "allow the agent?"
 *   GET  /team/members  the members this Studio has seen, plus the accepted
 *                       reviewers, with each one's agent delegation. An org's
 *                       full member list is not readable from the pod (Renown's
 *                       organizationMembers needs a wallet-signed OrgAuthInput),
 *                       so `limited` says the list is the seen members only.
 *   POST /team/relay    append actions signed in the caller's own browser,
 *                       after checking each action's type, signature and the
 *                       caller's capability for it; the action is appended
 *                       unchanged (P6-3).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Action } from "@powerhousedao/shared/document-model";

import { CAPABILITIES, type Capability, type Member } from "../team/roles.js";
import type { VerifyResult } from "../team/trust.js";
import type { MemberCheck } from "./request-auth.js";

/** Action types Viewers/guests may relay, with the capability each needs. */
export const RELAY_ACTION_TYPES: Readonly<Record<string, Capability>> = {
  START_THREAD: "comment",
  ADD_COMMENT: "comment",
  RESOLVE_THREAD: "comment",
  REOPEN_THREAD: "comment",
  LINK_CHANGE: "comment",
  // Steer actions (TAG_REQUEST) wait for task 3.2: the change owner must be
  // read from the change document, not taken from the request body.
};

const MAX_BODY_BYTES = 1_000_000;

/** One row of `GET /team/members`. */
export interface TeamMemberView {
  address: string;
  name: string | null;
  role: Member["role"];
  reviewer: boolean;
  /** The member allowed the Studio's agent (their own delegation, 1.11). */
  allowedAgent: boolean;
  /** An Owner limited this member to watching here (a VIEWER role override). */
  overridden: boolean;
}

export interface TeamRouteDeps {
  orgId: string | null;
  /** The members the gate has admitted (task 1.10's seen members). */
  seen(): Promise<Array<Pick<Member, "address" | "name" | "role" | "reviewer">>>;
  /** The accepted reviewers, with their base role (accepted team operations). */
  reviewers(): Promise<Array<Pick<Member, "address" | "name" | "role" | "reviewer">>>;
  /** Whether the member already allowed the agent (their own delegation). */
  hasDelegation(address: string): Promise<boolean>;
  /** The members an Owner limited to viewing here (lower-case addresses). */
  overridden(): Promise<ReadonlySet<string>>;
  /** Verify one action's v2 signature and delegation for `documentId`. */
  verifyAction(action: Action, documentId: string): Promise<VerifyResult>;
  /** Append the verified actions unchanged. */
  relay(documentId: string, actions: Action[]): Promise<void>;
}

export class BadRelayRequestError extends Error {
  override name = "BadRelayRequestError";
}

type AcceptedCheck = Extract<MemberCheck, { ok: true }>;

export interface TeamRouteCall {
  req: IncomingMessage;
  res: ServerResponse;
  url: string;
  method: string;
  check: AcceptedCheck;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function queryOf(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return idx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(idx + 1));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BadRelayRequestError("body too large");
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new BadRelayRequestError("invalid json");
  }
}

function isAction(value: unknown): value is Action {
  const a = value as Partial<Action> | null;
  return !!a && typeof a.id === "string" && typeof a.type === "string" && typeof a.input === "object";
}

export interface TeamRoutes {
  /** Serve one team route; the caller has already passed the capability gate. */
  handle(call: TeamRouteCall): Promise<void>;
}

export function createTeamRoutes(deps: TeamRouteDeps): TeamRoutes {
  async function me({ res, check }: TeamRouteCall) {
    const member = check.member;
    const needsAllow =
      !!member &&
      (member.role === "owner" || member.role === "maker") &&
      !(await deps.hasDelegation(member.address));
    writeJson(res, 200, { member, orgId: deps.orgId, needsAllow });
  }

  async function members({ res, check }: TeamRouteCall) {
    const byAddress = new Map<
      string,
      Pick<Member, "address" | "name" | "role" | "reviewer">
    >();
    for (const m of await deps.seen()) byAddress.set(m.address.toLowerCase(), m);
    for (const reviewer of await deps.reviewers()) {
      const key = reviewer.address.toLowerCase();
      const known = byAddress.get(key);
      byAddress.set(key, { ...(known ?? reviewer), reviewer: true });
    }
    const me = check.member;
    if (me) byAddress.set(me.address.toLowerCase(), me);

    const overridden = await deps.overridden();
    const members: TeamMemberView[] = [];
    for (const m of byAddress.values()) {
      members.push({
        ...m,
        allowedAgent: await deps.hasDelegation(m.address),
        overridden: overridden.has(m.address.toLowerCase()),
      });
    }
    // An org's full member list cannot be read here; the caller sees who has
    // opened the Studio and who an Owner made a Reviewer.
    writeJson(res, 200, { orgId: deps.orgId, members, limited: deps.orgId !== null });
  }

  async function relay({ req, res, url, check }: TeamRouteCall) {
    const member = check.member;
    const body = (await readJsonBody(req)) as {
      documentId?: unknown;
      actions?: unknown;
      changeId?: unknown;
      changeOwner?: unknown;
    };
    if (typeof body.documentId !== "string" || !body.documentId) {
      throw new BadRelayRequestError("missing documentId");
    }
    if (!Array.isArray(body.actions) || body.actions.length === 0 || !body.actions.every(isAction)) {
      throw new BadRelayRequestError("invalid actions");
    }
    const changeId =
      typeof body.changeId === "string"
        ? body.changeId
        : queryOf(url).get("changeId") ?? undefined;
    const changeOwner = typeof body.changeOwner === "string" ? body.changeOwner : undefined;

    for (const action of body.actions) {
      const needed = RELAY_ACTION_TYPES[action.type];
      if (!needed) {
        writeJson(res, 403, { error: "action-type-not-allowed" });
        return;
      }
      // A relayed action is the caller's own: it must be signed by them.
      const signer = action.context?.signer as
        | { user?: { address?: string } }
        | undefined;
      const address = signer?.user?.address?.toLowerCase();
      if (member && address !== member.address.toLowerCase()) {
        writeJson(res, 403, { error: "forbidden" });
        return;
      }
      if (member && !CAPABILITIES[needed](member, { changeId, changeOwner })) {
        writeJson(res, 403, { error: "forbidden" });
        return;
      }
      const verified = await deps.verifyAction(action, body.documentId);
      if ("refused" in verified) {
        writeJson(res, 403, { error: verified.refused });
        return;
      }
      if (member && verified.address !== member.address.toLowerCase()) {
        writeJson(res, 403, { error: "forbidden" });
        return;
      }
    }

    await deps.relay(body.documentId, body.actions);
    writeJson(res, 200, { ok: true, appended: body.actions.length });
  }

  return {
    async handle(call) {
      const path = call.url.split("?")[0];
      try {
        if (call.method === "GET" && path === "/team/me") return await me(call);
        if (call.method === "GET" && path === "/team/members") return await members(call);
        if (call.method === "POST" && path === "/team/relay") return await relay(call);
        writeJson(call.res, 404, { error: "not found" });
      } catch (err) {
        if (err instanceof BadRelayRequestError) {
          writeJson(call.res, 400, { error: err.message });
          return;
        }
        writeJson(call.res, 500, { error: "internal" });
      }
    },
  };
}
