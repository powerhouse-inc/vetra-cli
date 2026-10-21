import { describe, expect, it, jest } from "@jest/globals";

import { fetchOrgMembership, RenownOrgsUnavailableError } from "../../src/team/renown-orgs.js";

const URL_ = "https://orgs.example/graphql/renown-orgs";
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe("fetchOrgMembership", () => {
  it("lowercases the address and returns the membership", async () => {
    const f = jest.fn<typeof fetch>(async () =>
      json({ data: { orgMembership: { role: "PUBLISHER", status: "ACTIVE", effectiveScope: { all: false, appDids: ["did:x"] } } } }),
    );
    const m = await fetchOrgMembership(URL_, "acme", "0xABCDEF", { fetch: f });
    expect(m).toEqual({ role: "PUBLISHER", status: "ACTIVE", effectiveScope: { all: false, appDids: ["did:x"] } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_);
    expect(JSON.parse(String(init!.body)).variables).toEqual({ orgId: "acme", address: "0xabcdef" });
  });

  it("returns null for a non-member", async () => {
    const f = async () => json({ data: { orgMembership: null } });
    expect(await fetchOrgMembership(URL_, "acme", "0x1", { fetch: f })).toBeNull();
  });

  it("throws a typed error on network, HTTP, GraphQL and shape failures", async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => { throw new Error("boom"); },
      async () => json({}, 503),
      async () => json({ errors: [{ message: "nope" }], data: null }),
      async () => json({ data: { orgMembership: { role: "WIZARD", status: "ACTIVE", effectiveScope: { all: true, appDids: [] } } } }),
      async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) as unknown as Response,
    ];
    for (const f of cases) {
      await expect(fetchOrgMembership(URL_, "acme", "0x1", { fetch: f })).rejects.toBeInstanceOf(RenownOrgsUnavailableError);
    }
  });
});
