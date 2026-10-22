/**
 * The trust policy of a new cloud Studio's reactor (Task 5.SIG, ruling X39).
 *
 * A write is admitted only when its signer claims the **owner's** wallet and
 * that wallet's Renown credential delegates to the signing key:
 *
 *   1. `isAdminAddress(user.address, ADMINS)` — only the Studio's owner (an
 *      wallet in the ADMINS allowlist) may write its documents. An anonymous
 *      signer (no user), a non-owner wallet and an empty allowlist are refused.
 *   2. `createRenownTrustPolicy({ renownUrl, ownSigner })` — the user's
 *      EIP-712 credential must delegate to the key. The reactor's own key
 *      signing as its own user is accepted without a lookup (self check), so
 *      the agent never depends on a Renown round-trip for its own writes.
 *
 * A refused signer means the reactor drops the operation (`SIGNER_UNAUTHORIZED`
 * / `UNSIGNED_REQUIRED`); it is never written unsigned.
 */
import {
  createRenownTrustPolicy,
  type RenownTrustPolicy,
  type RenownTrustPolicyOptions,
} from "@renown/sdk";
import { isAdminAddress } from "./renown.js";

/** Structural slice of a signer the policy reads. */
export interface TrustSignerLike {
  user?: { address?: string };
  app?: { key?: string };
}

/** Structural slice of the reactor's `SignatureTrustPolicy`. */
export interface SignatureTrustPolicyLike {
  authorizeSigner(
    signer: unknown,
    key: string,
    documentId: string,
  ): Promise<boolean>;
}

export interface OwnerTrustPolicyOptions {
  /** The Studio's Renown (R21), the one the browser logs in on. */
  renownUrl?: string;
  /** The agent's own signer, so its own key needs no Renown lookup. */
  ownSigner?: RenownTrustPolicyOptions["ownSigner"];
  /** ADMINS allowlist; defaults to `process.env.ADMINS`. */
  adminsEnv?: string;
  /** Inject a ready-made Renown policy (tests). */
  renownPolicy?: RenownTrustPolicy;
}

const addressOf = (signer: unknown): string | undefined => {
  const user = (signer as TrustSignerLike | undefined)?.user;
  return typeof user?.address === "string" ? user.address : undefined;
};

/** Owner-only writes, backed by the owner's Renown delegation. */
export function createOwnerTrustPolicy(
  options: OwnerTrustPolicyOptions = {},
): SignatureTrustPolicyLike {
  const renown =
    options.renownPolicy ??
    createRenownTrustPolicy({
      renownUrl: options.renownUrl,
      ownSigner: options.ownSigner,
    });
  const adminsEnv = options.adminsEnv ?? process.env.ADMINS;
  return {
    async authorizeSigner(signer, key, documentId) {
      const address = addressOf(signer);
      if (!isAdminAddress(address, adminsEnv)) return false;
      return renown.authorizeSigner(signer as never, key, documentId);
    },
  };
}
