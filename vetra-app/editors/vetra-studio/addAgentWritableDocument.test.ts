import { signaturePolicyOf, type PHDocument } from "document-model";
import { describe, expect, it, vi } from "vitest";
import { BrandSheet } from "../../document-models/brand-sheet/v1/module.js";
import { addAgentWritableDocument } from "./addAgentWritableDocument.js";
import { SignInRequiredError } from "./studioWrite.js";

function setup(policy: "legacy" | "v2-required" = "legacy") {
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
  const getCreateSignaturePolicy = vi.fn(() => Promise.resolve(policy));
  const signInRequired = vi.fn(() => Promise.resolve(false));
  return {
    addDocument,
    getDocumentModelModule,
    getCreateSignaturePolicy,
    signInRequired,
    isSignedIn: () => true,
  };
}

describe("addAgentWritableDocument", () => {
  it("creates under the policy the daemon stamped (legacy, as before)", async () => {
    const deps = setup("legacy");

    const node = await addAgentWritableDocument(
      "drive-1",
      "Session 1",
      "powerhouse/brand-sheet",
      deps,
    );

    expect(node.id).toBe("created-id");
    expect(deps.getCreateSignaturePolicy).toHaveBeenCalledTimes(1);
    expect(deps.getDocumentModelModule).toHaveBeenCalledWith(
      "powerhouse/brand-sheet",
    );
    const [driveId, name, type, parent, document] =
      deps.addDocument.mock.calls[0];
    expect([driveId, name, type, parent]).toEqual([
      "drive-1",
      "Session 1",
      "powerhouse/brand-sheet",
      undefined,
    ]);
    expect(signaturePolicyOf(document!.header)).toBe("legacy");
    expect(document!.header.documentType).toBe("powerhouse/brand-sheet");
    expect(document!.state.document.version).toBe(BrandSheet.version);
  });

  it("creates v2-required in a new cloud Studio", async () => {
    // The 6.2.3 default is v2-required; the daemon stamps it for cloud Studios.
    expect(signaturePolicyOf(BrandSheet.utils.createDocument().header)).toBe(
      "v2-required",
    );
    const deps = setup("v2-required");

    await addAgentWritableDocument(
      "drive-1",
      "Session 1",
      "powerhouse/brand-sheet",
      deps,
    );

    const document = deps.addDocument.mock.calls[0][4];
    expect(signaturePolicyOf(document!.header)).toBe("v2-required");
    expect(document!.header.id).not.toBe("");
  });

  it("refuses before creating anything when the cloud Studio is signed out", async () => {
    const deps = setup("v2-required");
    deps.signInRequired = vi.fn(() => Promise.resolve(true));

    await expect(
      addAgentWritableDocument(
        "drive-1",
        "Session 1",
        "powerhouse/brand-sheet",
        { ...deps, isSignedIn: () => false },
      ),
    ).rejects.toBeInstanceOf(SignInRequiredError);

    expect(deps.addDocument).not.toHaveBeenCalled();
    expect(deps.getDocumentModelModule).not.toHaveBeenCalled();
  });
});
