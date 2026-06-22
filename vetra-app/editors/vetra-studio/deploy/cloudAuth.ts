import { useRenown, useRenownAuth } from "@powerhousedao/reactor-browser";
import type { ISigner } from "document-model";

export type CloudAuth = {
  /** Renown signer once logged in; null while loading / signed out. */
  signer: ISigner | null;
  authorized: boolean;
  loading: boolean;
  address: string | undefined;
  login: () => void;
};

/** Renown identity for the cloud Deploy flow: the signer for signed pushes
 * plus the auth-gate state. */
export function useCloudAuth(): CloudAuth {
  const renown = useRenown();
  const auth = useRenownAuth();
  const signer =
    (renown as { signer?: ISigner } | null | undefined)?.signer ?? null;
  return {
    signer,
    authorized: auth.status === "authorized",
    loading: auth.status === "loading" || auth.status === "checking",
    address: auth.address,
    login: auth.login,
  };
}
