import { describe, expect, it } from "@jest/globals";

import { generateSubdomain } from "@powerhousedao/vetra-cloud-client";

// Guards the verbatim move of the subdomain generator into the shared package:
// these vectors must stay byte-for-byte stable (the gitops namespace derives
// from the same fragment, so drift would re-route environments).
describe("generateSubdomain", () => {
  it("produces stable adjective-animal-shortid output for known ids", () => {
    expect(generateSubdomain("00000000-0000-0000-0000-000000000000")).toBe(
      "vivid-wolf-00000000",
    );
    expect(generateSubdomain("11111111-2222-3333-4444-555555555555")).toBe(
      "teal-lynx-11111111",
    );
    expect(generateSubdomain("deadbeef-cafe-babe-f00d-0123456789ab")).toBe(
      "calm-duck-deadbeef",
    );
  });

  it("is deterministic for the same id", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    expect(generateSubdomain(id)).toBe(generateSubdomain(id));
  });
});
