import type { ISigner } from "document-model";
import { useEffect, useState } from "react";
import type { VetraCloudEnvironmentGlobalState } from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";
import {
  loadEnvironmentController,
  type EnvironmentController,
} from "./cloudController.js";

export type EnvironmentControllerState = {
  controller: EnvironmentController | null;
  state: VetraCloudEnvironmentGlobalState | null;
  isLoading: boolean;
  error: Error | null;
};

/**
 * Load a vetra-cloud-environment document into a RemoteDocumentController tied
 * to the user's Renown signer, and subscribe to its changes. Ported from
 * vetra.to's use-environment-controller.
 */
export function useEnvironmentController(
  documentId: string | null,
  driveId: string,
  signer: ISigner | null,
): EnvironmentControllerState {
  const [controller, setController] = useState<EnvironmentController | null>(
    null,
  );
  const [state, setState] = useState<VetraCloudEnvironmentGlobalState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!signer || !documentId) {
      setIsLoading(false);
      return;
    }
    // Mutable flag (object property, not a `let`) so the post-await reads
    // aren't narrowed to a constant and flagged as dead by the linter.
    const alive = { current: true };
    let unsubscribe: (() => void) | undefined;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const ctrl = await loadEnvironmentController({
          documentId,
          parentIdentifier: driveId,
          signer,
        });
        if (!alive.current) return;
        setController(ctrl);
        setState(ctrl.state.global);
        unsubscribe = ctrl.onChange(() => {
          if (alive.current) setState(ctrl.state.global);
        });
        setIsLoading(false);
      } catch (err) {
        if (!alive.current) return;
        setError(
          err instanceof Error ? err : new Error("Failed to load environment"),
        );
        setIsLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      unsubscribe?.();
      setController(null);
    };
  }, [documentId, driveId, signer]);

  return { controller, state, isLoading, error };
}
