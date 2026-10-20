import { signaturePolicyOf, type PHDocument } from "document-model";
import { describe, expect, it, vi } from "vitest";
import { BrandSheet } from "../../document-models/brand-sheet/v1/module.js";
import { addAgentWritableDocument } from "./addAgentWritableDocument.js";

function setup() {
  const addDocument = vi.fn(
    (
      driveId: string,
      name: string,
      documentType: string,
      _parentFolder?: string,
      _document?: PHDocument,
    ) =>
      Promise.resolve({
        id: "created-id",
        name,
        documentType,
        parentFolder: null,
        kind: "file" as const,
      }),
  );
  const getDocumentModelModule = vi.fn(() => Promise.resolve(BrandSheet));
  return { addDocument, getDocumentModelModule };
}

describe("addAgentWritableDocument", () => {
  it("creates the document under the legacy signature policy", async () => {
    // The 6.2.3 default is v2-required; the agent writes unsigned server-side.
    expect(signaturePolicyOf(BrandSheet.utils.createDocument().header)).toBe(
      "v2-required",
    );
    const deps = setup();

    const node = await addAgentWritableDocument(
      "drive-1",
      "Session 1",
      "powerhouse/brand-sheet",
      deps,
    );

    expect(node.id).toBe("created-id");
    expect(deps.getDocumentModelModule).toHaveBeenCalledWith(
      "powerhouse/brand-sheet",
    );
    expect(deps.addDocument).toHaveBeenCalledTimes(1);
    const [driveId, name, type, parent, document] =
      deps.addDocument.mock.calls[0];
    expect([driveId, name, type, parent]).toEqual([
      "drive-1",
      "Session 1",
      "powerhouse/brand-sheet",
      undefined,
    ]);
    expect(document).toBeDefined();
    expect(signaturePolicyOf(document!.header)).toBe("legacy");
    expect(document!.header.documentType).toBe("powerhouse/brand-sheet");
    expect(document!.state.document.version).toBe(BrandSheet.version);
  });
});
