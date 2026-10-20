import { addDocument } from "@powerhousedao/reactor-browser";
import { withSignaturePolicy, type PHDocument } from "document-model";

interface DocumentModelModuleLike {
  version?: number;
  utils: { createDocument(): PHDocument };
}

export interface AgentWritableDocumentDeps {
  getDocumentModelModule(
    documentType: string,
  ): Promise<DocumentModelModuleLike>;
  addDocument(
    driveId: string,
    name: string,
    documentType: string,
    parentFolder?: string,
    document?: PHDocument,
  ): ReturnType<typeof addDocument>;
}

const defaultDeps: AgentWritableDocumentDeps = {
  getDocumentModelModule(documentType) {
    const client = window.ph?.reactorClientModule?.client;
    if (!client) throw new Error("ReactorClient not initialized");
    return client.getDocumentModelModule(documentType);
  },
  addDocument,
};

/**
 * Add a document to the Studio drive that the agent writes to server-side.
 *
 * From Powerhouse 6.2.3 a document's signature policy is fixed by its create
 * operation, and Connect creates documents as `v2-required`. The agent writes
 * these documents unsigned (chat-session init, turns, spec sync), so they are
 * created under the `legacy` policy, the same way ph-clint and the vetra-cli
 * spec commands create theirs. Mirrors `addDocument` otherwise.
 */
export async function addAgentWritableDocument(
  driveId: string,
  name: string,
  documentType: string,
  deps: AgentWritableDocumentDeps = defaultDeps,
): ReturnType<typeof addDocument> {
  const module = await deps.getDocumentModelModule(documentType);
  const document = withSignaturePolicy(module.utils.createDocument(), "legacy");
  document.state.document.version = module.version ?? 1;
  return deps.addDocument(driveId, name, documentType, undefined, document);
}
