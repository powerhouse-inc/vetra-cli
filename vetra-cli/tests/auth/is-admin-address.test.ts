import { describe, expect, it } from "@jest/globals";

import { isAdminAddress } from "../../src/auth/renown.js";

describe("isAdminAddress — export owner gate", () => {
  const OWNER = "0xAbC0000000000000000000000000000000000001";

  it("matches case-insensitively", () => {
    expect(isAdminAddress(OWNER, OWNER.toLowerCase())).toBe(true);
    expect(isAdminAddress(OWNER.toLowerCase(), OWNER)).toBe(true);
  });

  it("matches within a comma- or whitespace-separated allowlist", () => {
    const admins = `0xdead, ${OWNER}\n0xbeef`;
    expect(isAdminAddress(OWNER, admins)).toBe(true);
    expect(isAdminAddress("0xbeef", admins)).toBe(true);
    expect(isAdminAddress("0xnope", admins)).toBe(false);
  });

  it("empty / unset allowlist matches nothing", () => {
    expect(isAdminAddress(OWNER, "")).toBe(false);
    expect(isAdminAddress(OWNER, undefined)).toBe(false);
    expect(isAdminAddress(OWNER, "   ")).toBe(false);
  });

  it("no address matches nothing", () => {
    expect(isAdminAddress(undefined, OWNER)).toBe(false);
    expect(isAdminAddress("", OWNER)).toBe(false);
  });
});
