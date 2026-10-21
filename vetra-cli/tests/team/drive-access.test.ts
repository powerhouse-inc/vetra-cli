import { describe, expect, it, jest } from "@jest/globals";

import {
  createSwitchboardDriveAccess,
  drivePermissionFor,
  syncDriveAccess,
  type DriveAccessTransport,
  type PermissionRow,
} from "../../src/team/drive-access.js";
import type { Member } from "../../src/team/roles.js";

const DRIVE = "drive-doc";
const OWNER = "0x1111111111111111111111111111111111111111";
const MAKER = "0x2222222222222222222222222222222222222222";
const VIEWER = "0x3333333333333333333333333333333333333333";
const GUEST = "0x4444444444444444444444444444444444444444";
const UNKNOWN = "0x5555555555555555555555555555555555555555";

const member = (address: string, role: Member["role"], guest = false): Member => ({
  address,
  name: null,
  role,
  reviewer: false,
  ...(guest ? { guest: { id: "g", changeId: "c", rights: "COMMENT" as const, expiresAt: "2099-01-01T00:00:00.000Z" } } : {}),
});

function setup(rows: PermissionRow[]) {
  const list = jest.fn(async () => rows);
  const grant = jest.fn(async () => {});
  const revoke = jest.fn(async () => {});
  const transport: DriveAccessTransport = { list, grant, revoke };
  return { transport, list, grant, revoke };
}

describe("drivePermissionFor", () => {
  it("owners and makers write, viewers read, guests and null get nothing", () => {
    expect(drivePermissionFor(member(OWNER, "owner"))).toBe("WRITE");
    expect(drivePermissionFor(member(MAKER, "maker"))).toBe("WRITE");
    expect(drivePermissionFor(member(VIEWER, "viewer"))).toBe("READ");
    expect(drivePermissionFor(member(GUEST, "guest", true))).toBeNull();
    expect(drivePermissionFor(null)).toBeNull();
  });
});

describe("syncDriveAccess", () => {
  it("grants owners/makers WRITE and viewers READ, revokes guests, keeps ADMIN rows", async () => {
    const { transport, grant, revoke } = setup([
      { userAddress: OWNER.toUpperCase().replace("0X", "0x"), permission: "ADMIN" },
      { userAddress: GUEST, permission: "READ" },
    ]);
    const result = await syncDriveAccess({ transport, documentId: DRIVE }, [
      member(OWNER, "owner"),
      member(MAKER, "maker"),
      member(VIEWER, "viewer"),
      member(GUEST, "guest", true),
    ]);
    expect(grant.mock.calls).toEqual([
      [DRIVE, MAKER, "WRITE"],
      [DRIVE, VIEWER, "READ"],
    ]);
    expect(revoke.mock.calls).toEqual([[DRIVE, GUEST]]);
    expect(result).toEqual({ granted: [MAKER, VIEWER], revoked: [GUEST] });
  });

  it("does not regrant a member already at the right level and downgrades a maker", async () => {
    const { transport, grant } = setup([
      { userAddress: MAKER, permission: "READ" },
      { userAddress: VIEWER, permission: "READ" },
    ]);
    await syncDriveAccess({ transport, documentId: DRIVE }, [
      member(MAKER, "maker"),
      member(VIEWER, "viewer"),
    ]);
    expect(grant.mock.calls).toEqual([[DRIVE, MAKER, "WRITE"]]);
  });

  it("revokes unknown READ/WRITE rows only when the member list is complete", async () => {
    const rows = [{ userAddress: UNKNOWN, permission: "READ" as const }];
    const a = setup(rows);
    await syncDriveAccess({ transport: a.transport, documentId: DRIVE }, []);
    expect(a.revoke).toHaveBeenCalledWith(DRIVE, UNKNOWN);

    const b = setup(rows);
    await syncDriveAccess({ transport: b.transport, documentId: DRIVE }, [], { revokeUnknown: false });
    expect(b.revoke).not.toHaveBeenCalled();
  });
});

describe("switchboard transport", () => {
  function fakeFetch(data: unknown) {
    const calls: { url: unknown; init: RequestInit }[] = [];
    const fn = jest.fn(async (url: unknown, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    });
    return { fetch: fn as unknown as typeof fetch, calls };
  }

  it("uses the auth subgraph's documentAccess / grant / revoke with a bearer", async () => {
    const list = fakeFetch({ documentAccess: { permissions: [{ userAddress: OWNER, permission: "ADMIN" }] } });
    const grant = fakeFetch({ grantDocumentPermission: { userAddress: MAKER, permission: "WRITE" } });
    const revoke = fakeFetch({ revokeDocumentPermission: true });
    expect(
      await createSwitchboardDriveAccess({
        url: "http://127.0.0.1:4001/graphql",
        token: async () => "bearer-token",
        fetch: list.fetch,
      }).list(DRIVE),
    ).toEqual([{ userAddress: OWNER, permission: "ADMIN" }]);
    expect(list.calls[0].init.headers).toMatchObject({ authorization: "Bearer bearer-token" });
    expect(String(list.calls[0].init.body)).toContain("documentAccess");

    await createSwitchboardDriveAccess({
      url: "http://127.0.0.1:4001/graphql",
      token: async () => "bearer-token",
      fetch: grant.fetch,
    }).grant(DRIVE, MAKER, "WRITE");
    expect(String(grant.calls[0].init.body)).toContain("grantDocumentPermission");
    expect(String(grant.calls[0].init.body)).toContain('"user":"' + MAKER + '"');

    await createSwitchboardDriveAccess({
      url: "http://127.0.0.1:4001/graphql",
      token: async () => "bearer-token",
      fetch: revoke.fetch,
    }).revoke(DRIVE, MAKER);
    expect(String(revoke.calls[0].init.body)).toContain("revokeDocumentPermission");
  });

  it("fails closed without a bearer or on a GraphQL error", async () => {
    const transport = createSwitchboardDriveAccess({
      url: "http://127.0.0.1:4001/graphql",
      token: async () => null,
    });
    await expect(transport.list(DRIVE)).rejects.toThrow(/not signed in/);

    const failing = createSwitchboardDriveAccess({
      url: "http://127.0.0.1:4001/graphql",
      token: async () => "t",
      fetch: (async () =>
        ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "Forbidden" }] }) }) as Response) as unknown as typeof fetch,
    });
    await expect(failing.grant(DRIVE, MAKER, "WRITE")).rejects.toThrow(/Forbidden/);
  });
});
