import { generateMock } from "document-model";
import {
  clearEstimates,
  ClearEstimatesInputSchema,
  clearExpectedEffect,
  ClearExpectedEffectInputSchema,
  clearFeatureName,
  ClearFeatureNameInputSchema,
  clearNotes,
  ClearNotesInputSchema,
  clearPremise,
  ClearPremiseInputSchema,
  clearReasoning,
  ClearReasoningInputSchema,
  clearSummary,
  ClearSummaryInputSchema,
  clearTargetRelease,
  ClearTargetReleaseInputSchema,
  isFeatureDocument,
  reducer,
  setConfidence,
  SetConfidenceInputSchema,
  setEffort,
  SetEffortInputSchema,
  setExpectedEffect,
  SetExpectedEffectInputSchema,
  setFeatureName,
  SetFeatureNameInputSchema,
  setImpact,
  SetImpactInputSchema,
  setNotes,
  SetNotesInputSchema,
  setPremise,
  SetPremiseInputSchema,
  setReasoning,
  SetReasoningInputSchema,
  setScope,
  SetScopeInputSchema,
  setSummary,
  SetSummaryInputSchema,
  setTargetRelease,
  SetTargetReleaseInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("DefinitionOperations", () => {
  it("should handle setFeatureName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetFeatureNameInputSchema());

    const updatedDocument = reducer(document, setFeatureName(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_FEATURE_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearFeatureName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearFeatureNameInputSchema());

    const updatedDocument = reducer(document, clearFeatureName(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_FEATURE_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setSummary operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetSummaryInputSchema());

    const updatedDocument = reducer(document, setSummary(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_SUMMARY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearSummary operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearSummaryInputSchema());

    const updatedDocument = reducer(document, clearSummary(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_SUMMARY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setScope operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetScopeInputSchema());

    const updatedDocument = reducer(document, setScope(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_SCOPE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setPremise operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetPremiseInputSchema());

    const updatedDocument = reducer(document, setPremise(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PREMISE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearPremise operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearPremiseInputSchema());

    const updatedDocument = reducer(document, clearPremise(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_PREMISE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setExpectedEffect operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetExpectedEffectInputSchema());

    const updatedDocument = reducer(document, setExpectedEffect(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_EXPECTED_EFFECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearExpectedEffect operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearExpectedEffectInputSchema());

    const updatedDocument = reducer(document, clearExpectedEffect(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_EXPECTED_EFFECT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setReasoning operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetReasoningInputSchema());

    const updatedDocument = reducer(document, setReasoning(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_REASONING",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearReasoning operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearReasoningInputSchema());

    const updatedDocument = reducer(document, clearReasoning(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_REASONING",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setNotes operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetNotesInputSchema());

    const updatedDocument = reducer(document, setNotes(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_NOTES");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearNotes operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearNotesInputSchema());

    const updatedDocument = reducer(document, clearNotes(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_NOTES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTargetRelease operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTargetReleaseInputSchema());

    const updatedDocument = reducer(document, setTargetRelease(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TARGET_RELEASE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearTargetRelease operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearTargetReleaseInputSchema());

    const updatedDocument = reducer(document, clearTargetRelease(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_TARGET_RELEASE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setConfidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetConfidenceInputSchema());

    const updatedDocument = reducer(document, setConfidence(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_CONFIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setEffort operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetEffortInputSchema());

    const updatedDocument = reducer(document, setEffort(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_EFFORT");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setImpact operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetImpactInputSchema());

    const updatedDocument = reducer(document, setImpact(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_IMPACT");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearEstimates operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearEstimatesInputSchema());

    const updatedDocument = reducer(document, clearEstimates(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_ESTIMATES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
