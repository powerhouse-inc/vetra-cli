import { addDocument } from "@powerhousedao/reactor-browser";
import { withSignaturePolicy, type PHDocument } from "document-model";
import {
  assertStudioWritable,
  type StudioWriteGateDeps,
} from "./studioWrite.js";

type SignaturePolicy = "legacy" | "v2-required";

interface DocumentModelModuleLike {
  version?: number;
  utils: { createDocument(): PHDocument };
}

export interface AgentWritableDocumentDeps extends StudioWriteGateDeps {
  getDocumentModelModule(
    documentType: string,
  ): Promise<DocumentModelModuleLike>;
  /** The create policy the daemon stamped for this Studio. */
  getCreateSignaturePolicy?(): Promise<SignaturePolicy>;
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
  async getCreateSignaturePolicy() {
    const client = window.ph?.reactorClientModule?.client as
      | { getCreateSignaturePolicy?: () => Promise<SignaturePolicy> }
      | undefined;
    if (!client?.getCreateSignaturePolicy) return "v2-required";
    return client.getCreateSignaturePolicy();
  },
  addDocument,
};

/**
 * Add a document to the Studio drive that the agent writes to server-side.
 *
 * The signature policy is the one the daemon stamped into the Connect runtime
 * config (`connect.reactor.createSignaturePolicy`), read off the reactor client
 * (Task 5.SIG, ruling X39):
 *
 * - a **new cloud Studio** creates documents `v2-required`; the owner's browser
 *   signs them and the agent writes them with its delegated key;
 * - a **local Studio**, and a cloud Studio from before the marker, keeps
 *   `legacy`, exactly as before.
 *
 * A signed-out page in a cloud Studio is refused before the document is built,
 * so nothing is created that could never be signed.
 */
export async function addAgentWritableDocument(
  driveId: string,
  name: string,
  documentType: string,
  deps: AgentWritableDocumentDeps = defaultDeps,
): ReturnType<typeof addDocument> {
  const resolved = { ...defaultDeps, ...deps };
  await assertStudioWritable(resolved);
  const policy: SignaturePolicy =
    (await resolved.getCreateSignaturePolicy?.()) ?? "v2-required";
  const module = await resolved.getDocumentModelModule(documentType);
  const document = withSignaturePolicy(module.utils.createDocument(), policy);
  document.state.document.version = module.version ?? 1;
  return resolved.addDocument(
    driveId,
    name,
    documentType,
    undefined,
    document,
  );
}
