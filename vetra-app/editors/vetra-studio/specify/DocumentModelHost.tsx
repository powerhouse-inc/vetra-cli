import {
  setSelectedNode,
  useEditorModuleById,
  useEditorModulesForDocumentType,
  useNodeById,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { Suspense, useEffect } from "react";
import { DOCUMENT_MODEL_TYPE } from "./projects.js";

const DM_EDITOR_ID = "document-model-editor-v2";

function Loading() {
  return <div className="p-6 text-sm text-gray-400">Loading document…</div>;
}

/**
 * Renders the registry document-model editor for a model node. The editor's
 * Component is zero-prop and reads the *selected* document, so this host
 * drives Connect's node selection: select on mount/id-change, clear on
 * unmount. Render is gated on the selection matching so the editor never
 * mounts without its selected document.
 */
export function DocumentModelHost({ id }: { id: string }) {
  const node = useNodeById(id);
  const byId = useEditorModuleById(DM_EDITOR_ID);
  const byType = useEditorModulesForDocumentType(DOCUMENT_MODEL_TYPE);
  const mod = byId ?? byType?.[0];
  const selected = useSelectedNode();

  useEffect(() => {
    if (node) setSelectedNode(node);
    return () => setSelectedNode(undefined);
  }, [node]);

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
