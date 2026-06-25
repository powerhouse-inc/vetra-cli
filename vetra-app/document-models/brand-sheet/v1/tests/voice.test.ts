import { generateMock } from "document-model";
import {
  clearVoice,
  ClearVoiceInputSchema,
  isBrandSheetDocument,
  reducer,
  setVoice,
  SetVoiceInputSchema,
  setVoiceVocabulary,
  SetVoiceVocabularyInputSchema,
  updateVoice,
  UpdateVoiceInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("VoiceOperations", () => {
  it("should handle setVoice operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetVoiceInputSchema());

    const updatedDocument = reducer(document, setVoice(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_VOICE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateVoice operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateVoiceInputSchema());

    const updatedDocument = reducer(document, updateVoice(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_VOICE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setVoiceVocabulary operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetVoiceVocabularyInputSchema());

    const updatedDocument = reducer(document, setVoiceVocabulary(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_VOICE_VOCABULARY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearVoice operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearVoiceInputSchema());

    const updatedDocument = reducer(document, clearVoice(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_VOICE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
