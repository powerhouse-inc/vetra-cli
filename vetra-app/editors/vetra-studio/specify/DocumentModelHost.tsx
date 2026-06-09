import {
  setSelectedNode,
  useEditorModuleById,
  useEditorModulesForDocumentType,
  useNodeById,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { Suspense, useEffect, useRef } from "react";
import { DOCUMENT_MODEL_TYPE } from "./projects.js";

const DM_EDITOR_ID = "document-model-editor-v2";

function Loading() {
  return <div className="p-6 text-sm text-gray-400">Loading document…</div>;
}

/**
 * Renders the registry document-model editor for a model node. The editor's
 * Component is zero-prop and reads the *selected* document, so this host
 * drives Connect's node selection: select when the node resolves, clear on
 * unmount only if the selection is still ours. Render is gated on the
 * selection matching so the editor never mounts without its selected
 * document.
 *
 * The editor ships its own toolbar whose "Close document" button moves the
 * global selection to the parent folder. The host observes the selection
 * leaving the hosted node and reports it via `onClose` so the section drops
 * its open state instead of stranding on the loading gate.
 */
export function DocumentModelHost({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const node = useNodeById(id);
  const byId = useEditorModuleById(DM_EDITOR_ID);
  const byType = useEditorModulesForDocumentType(DOCUMENT_MODEL_TYPE);
  const mod = byId ?? byType?.[0];
  const selected = useSelectedNode();

  // Refs let the selection effects read fresh values while keying on stable
  // ids — node/selected get new object identities on every drive update, and
  // re-running the effects on those would churn the selection (and remount
  // the editor) on each sync tick.
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const selectedIdRef = useRef(selected?.id);
  selectedIdRef.current = selected?.id;
  const nodeResolved = node !== undefined;

  // Select once the node resolves (or the hosted id changes).
  useEffect(() => {
    const current = nodeRef.current;
    if (current) setSelectedNode(current);
  }, [id, nodeResolved]);

  // Clear on unmount/id-change, but only while the selection still points at
  // our node — never wipe a selection another surface has since taken over,
  // and never clear when we haven't selected anything yet.
  useEffect(() => {
    return () => {
      if (selectedIdRef.current === id) setSelectedNode(undefined);
    };
  }, [id]);

  // Selection moved off our node after having been on it (e.g. the editor
  // toolbar's "Close document" selects the parent folder) — report up.
  // Armed per-id so switching hosted models doesn't misfire.
  const armedForRef = useRef<string | null>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId === id) {
      armedForRef.current = id;
      return;
    }
    if (armedForRef.current === id) {
      armedForRef.current = null;
      onClose();
    }
  }, [selectedId, id, onClose]);

  if (!mod) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No document-model editor registered.
      </div>
    );
  }
  if (!node || selected?.id !== id) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <mod.Component />
    </Suspense>
  );
}
