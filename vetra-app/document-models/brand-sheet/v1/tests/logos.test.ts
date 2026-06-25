import { generateMock } from "document-model";
import {
  addLogo,
  AddLogoInputSchema,
  clearLogoAsset,
  ClearLogoAssetInputSchema,
  isBrandSheetDocument,
  reducer,
  removeLogo,
  RemoveLogoInputSchema,
  reorderLogos,
  ReorderLogosInputSchema,
  setLogoAsset,
  SetLogoAssetInputSchema,
  updateLogo,
  UpdateLogoInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("LogosOperations", () => {
  it("should handle addLogo operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddLogoInputSchema());

    const updatedDocument = reducer(document, addLogo(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_LOGO");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateLogo operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateLogoInputSchema());

    const updatedDocument = reducer(document, updateLogo(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_LOGO",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setLogoAsset operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetLogoAssetInputSchema(), {
      url: "https://example.com",
    });

    const updatedDocument = reducer(document, setLogoAsset(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_LOGO_ASSET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearLogoAsset operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearLogoAssetInputSchema());

    const updatedDocument = reducer(document, clearLogoAsset(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_LOGO_ASSET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeLogo operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveLogoInputSchema());

    const updatedDocument = reducer(document, removeLogo(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_LOGO",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderLogos operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderLogosInputSchema());

    const updatedDocument = reducer(document, reorderLogos(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_LOGOS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
