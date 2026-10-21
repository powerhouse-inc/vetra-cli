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
    const wrong = utils.createDocument();
    wrong.header.documentType = "the-wrong-thing-1234";
    expect(isStudioTeamDocument(wrong)).toBe(false);
    expect(() => assertIsStudioTeamDocument(wrong)).toThrow(ZodError);
  });

  it("should reject a wrong global state", () => {
    const wrong = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    wrong.state.global = { notWhat: "you want" };
    expect(isStudioTeamState(wrong.state)).toBe(false);
    expect(() => assertIsStudioTeamState(wrong.state)).toThrow(ZodError);
    expect(isStudioTeamDocument(wrong)).toBe(false);
  });

  it("should reject a wrong initial state", () => {
    const wrong = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    wrong.initialState.global = { notWhat: "you want" };
    expect(isStudioTeamDocument(wrong)).toBe(false);
    expect(() => assertIsStudioTeamDocument(wrong)).toThrow(ZodError);
  });

  it.each(["id", "name", "createdAtUtcIso", "lastModifiedAtUtcIso"] as const)(
    "should reject a document missing header.%s",
    (field) => {
      const wrong = utils.createDocument();
      delete wrong.header[field];
      expect(isStudioTeamDocument(wrong)).toBe(false);
      expect(() => assertIsStudioTeamDocument(wrong)).toThrow(ZodError);
    },
  );
});
