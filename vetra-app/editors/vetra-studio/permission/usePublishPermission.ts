/**
 * The owner's OK to publish (D7/F7): the product document's
 * `launchPermission`, the same Renown confirmation the deploy flow uses
 * (`useAgentAuth`), and an `allow()` that records `SET_LAUNCH_PERMISSION
 * GRANTED` once the owner approves.
 *
 * The page never calls the agent: the product document is the channel, and
 * the agent's requests trigger watches it (F7). Used by the sign-in modal
 * (Task 2.8) and the Live "needs you" row (Task 2.9).
 */
import {
  dispatchActions,
  useDocumentSafe,
} from "@powerhousedao/reactor-browser";
import {
  actions as productActions,
  isStudioProductDocument,
  type PermissionState,
} from "document-models/studio-product";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentAuth } from "../hooks/useAgentAuth.js";

export interface PublishPermission {
  /** The product's recorded state; null until the product document loads. */
  state: PermissionState | null;
  /** The agent already holds the owner's Renown delegation (no need to ask). */
  delegated: boolean;
  /** A Renown confirmation is running: waiting for the owner, or recording it. */
  pending: boolean;
  /**
   * The owner still has to approve in Renown (nothing is in flight here):
   * the Renown tab can be opened again with `reopen`.
   */
  waiting: boolean;
  /**
   * Runs the same Renown confirmation as the agent authorization. Resolves
   * true once the OK is recorded; false while the owner still has to approve
   * in the Renown console (the poll loop records it when they do).
   */
  allow: () => Promise<boolean>;
  /** Open the waiting Renown approval again (or start a fresh one). */
  reopen: () => Promise<void>;
}

export function usePublishPermission(
  productId: string | null,
): PublishPermission {
  const auth = useAgentAuth();
  const doc = useDocumentSafe(productId);
  const state =
    doc.status === "success" && isStudioProductDocument(doc.data)
      ? doc.data.state.global.launchPermission
      : null;
  const [recorded, setRecorded] = useState(false);
  const mounted = useRef(true);
  /** The owner pressed Allow: record GRANTED when Renown approves. */
  const asked = useRef(false);
  /** A delegation found at load was already reconciled into the product. */
  const reconciled = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const record = useCallback(
    async (next: PermissionState): Promise<boolean> => {
      if (!productId) return false;
      setRecorded(true);
      try {
        await dispatchActions(
          productActions.setLaunchPermission({ state: next }),
          productId,
        );
        return true;
      } catch {
        // The modal stays open: pressing Allow again retries the write.
        return false;
      } finally {
        if (mounted.current) setRecorded(false);
      }
    },
    [productId],
  );

  // A delegation that already exists is the owner's OK. Reconcile it into the
  // product document only from UNKNOWN: a recorded MISSING/EXPIRED is the
  // agent's finding and must not be papered over (that would resume a launch
  // the cloud keeps refusing).
  useEffect(() => {
    if (!auth.authenticated || !productId || reconciled.current) return;
    if (state !== "UNKNOWN") return;
    reconciled.current = true;
    void record("GRANTED");
  }, [auth.authenticated, productId, state, record]);

  // Approved in Renown after Allow: record it.
  useEffect(() => {
    if (!auth.authenticated || !asked.current) return;
    asked.current = false;
    void record("GRANTED");
  }, [auth.authenticated, record]);

  const allow = useCallback(async (): Promise<boolean> => {
    if (state === "GRANTED") return true;
    if (auth.authenticated) return record("GRANTED");
    asked.current = true;
    await auth.authorize();
    // The poll loop reports the approval; the effect above records it then.
    return false;
  }, [state, auth.authenticated, auth.authorize, record]);

  const reopen = useCallback(async (): Promise<void> => {
    // Record the OK when Renown approves, also after a reload of the page.
    asked.current = true;
    await auth.reopen();
  }, [auth.reopen]);

  return {
    state,
    delegated: auth.authenticated,
    pending: auth.busy || auth.pending || recorded,
    waiting: auth.pending && !auth.busy && !recorded,
    allow,
    reopen,
  };
}
