/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsStudioProductDocument,
  assertIsStudioProductState,
  initialGlobalState,
  initialLocalState,
  isStudioProductDocument,
  isStudioProductState,
  studioProductDocumentType,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("StudioProduct Document Model", () => {
  it("should create a new StudioProduct document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(studioProductDocumentType);
  });

  it("should create a new StudioProduct document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isStudioProductDocument(document)).toBe(true);
    expect(isStudioProductState(document.state)).toBe(true);
  });
  it("should reject a document that is not a StudioProduct document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsStudioProductDocument(wrongDocumentType)).toThrow();
      expect(isStudioProductDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongState.state.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isStudioProductState(wrongState.state)).toBe(false);
    expect(assertIsStudioProductState(wrongState.state)).toThrow();
    expect(isStudioProductDocument(wrongState)).toBe(false);
    expect(assertIsStudioProductDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isStudioProductState(wrongInitialState.state)).toBe(false);
    expect(assertIsStudioProductState(wrongInitialState.state)).toThrow();
    expect(isStudioProductDocument(wrongInitialState)).toBe(false);
    expect(assertIsStudioProductDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isStudioProductDocument(missingIdInHeader)).toBe(false);
    expect(assertIsStudioProductDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isStudioProductDocument(missingNameInHeader)).toBe(false);
    expect(assertIsStudioProductDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isStudioProductDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsStudioProductDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isStudioProductDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsStudioProductDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
