/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsStudioTeamDocument,
  assertIsStudioTeamState,
  initialGlobalState,
  initialLocalState,
  isStudioTeamDocument,
  isStudioTeamState,
  studioTeamDocumentType,
  utils,
} from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("StudioTeam Document Model", () => {
  it("should create a new StudioTeam document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(studioTeamDocumentType);
  });

  it("should create a new StudioTeam document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isStudioTeamDocument(document)).toBe(true);
    expect(isStudioTeamState(document.state)).toBe(true);
  });
  it("should reject a document that is not a StudioTeam document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsStudioTeamDocument(wrongDocumentType)).toThrow();
      expect(isStudioTeamDocument(wrongDocumentType)).toBe(false);
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
    expect(isStudioTeamState(wrongState.state)).toBe(false);
    expect(assertIsStudioTeamState(wrongState.state)).toThrow();
    expect(isStudioTeamDocument(wrongState)).toBe(false);
    expect(assertIsStudioTeamDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isStudioTeamState(wrongInitialState.state)).toBe(false);
    expect(assertIsStudioTeamState(wrongInitialState.state)).toThrow();
    expect(isStudioTeamDocument(wrongInitialState)).toBe(false);
    expect(assertIsStudioTeamDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isStudioTeamDocument(missingIdInHeader)).toBe(false);
    expect(assertIsStudioTeamDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isStudioTeamDocument(missingNameInHeader)).toBe(false);
    expect(assertIsStudioTeamDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isStudioTeamDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsStudioTeamDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isStudioTeamDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsStudioTeamDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
