/**
 * The owner-only trust policy of a new cloud Studio (Task 5.SIG, ruling X39).
 */
import { describe, it, expect, jest } from "@jest/globals";
import {
  createOwnerTrustPolicy,
  type SignatureTrustPolicyLike,
} from "../../src/auth/owner-trust.js";

const OWNER = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0xdef0000000000000000000000000000000000002";

function delegatedPolicy(accept: boolean): SignatureTrustPolicyLike & {
  authorizeSigner: jest.Mock;
} {
  return {
    authorizeSigner: jest.fn(() => Promise.resolve(accept)),
  } as unknown as SignatureTrustPolicyLike & { authorizeSigner: jest.Mock };
}

const signerFor = (address?: string) => ({
  user: address ? { address } : undefined,
  app: { key: "did:key:z6Mk" },
});

describe("createOwnerTrustPolicy", () => {
  it("accepts the owner's own key and asks Renown about the delegation", async () => {
    const renown = delegatedPolicy(true);
    const policy = createOwnerTrustPolicy({
      adminsEnv: OWNER,
      renownPolicy: renown as never,
    });

    await expect(
      policy.authorizeSigner(signerFor(OWNER), "did:key:z6Mk", "doc-1"),
    ).resolves.toBe(true);
    expect(renown.authorizeSigner).toHaveBeenCalledWith(
      signerFor(OWNER),
      "did:key:z6Mk",
      "doc-1",
    );
  });

  it("matches the ADMINS allowlist case-insensitively", async () => {
    const policy = createOwnerTrustPolicy({
      adminsEnv: `0xaaa, ${OWNER.toLowerCase()} `,
      renownPolicy: delegatedPolicy(true) as never,
    });
    await expect(
      policy.authorizeSigner(signerFor(OWNER), "k", "doc"),
    ).resolves.toBe(true);
  });

  it("refuses an anonymous signer before any Renown lookup", async () => {
    const renown = delegatedPolicy(true);
    const policy = createOwnerTrustPolicy({
      adminsEnv: OWNER,
      renownPolicy: renown as never,
    });
    await expect(
      policy.authorizeSigner(signerFor(undefined), "k", "doc"),
    ).resolves.toBe(false);
    expect(renown.authorizeSigner).not.toHaveBeenCalled();
  });

  it("refuses a wallet that is not the owner", async () => {
    const renown = delegatedPolicy(true);
    const policy = createOwnerTrustPolicy({
      adminsEnv: OWNER,
      renownPolicy: renown as never,
    });
    await expect(
      policy.authorizeSigner(signerFor(OTHER), "k", "doc"),
    ).resolves.toBe(false);
    expect(renown.authorizeSigner).not.toHaveBeenCalled();
  });

  it("refuses when the owner's credential does not delegate the key", async () => {
    const policy = createOwnerTrustPolicy({
      adminsEnv: OWNER,
      renownPolicy: delegatedPolicy(false) as never,
    });
    await expect(
      policy.authorizeSigner(signerFor(OWNER), "k", "doc"),
    ).resolves.toBe(false);
  });

  it("refuses everything with an empty allowlist (an unset ADMINS matches nothing)", async () => {
    const policy = createOwnerTrustPolicy({
      adminsEnv: "",
      renownPolicy: delegatedPolicy(true) as never,
    });
    await expect(
      policy.authorizeSigner(signerFor(OWNER), "k", "doc"),
    ).resolves.toBe(false);
  });
});
