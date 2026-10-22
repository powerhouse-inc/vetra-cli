/**
 * The browser-side sign-in gate of a cloud Studio (Task 5.SIG, ruling X39).
 */
import { describe, expect, it } from "vitest";
import {
  SIGN_IN_TO_CHANGE,
  SignInRequiredError,
  assertStudioWritable,
  writeRefused,
} from "./studioWrite.js";

describe("writeRefused", () => {
  it("refuses only a signed-out page that needs sign-in", () => {
    expect(writeRefused(true, false)).toBe(true);
    expect(writeRefused(true, true)).toBe(false);
    // A local Studio never needs a sign-in.
    expect(writeRefused(false, false)).toBe(false);
  });
});

describe("assertStudioWritable", () => {
  it("lets a local Studio write", async () => {
    await expect(
      assertStudioWritable({
        signInRequired: () => Promise.resolve(false),
        isSignedIn: () => false,
      }),
    ).resolves.toBeUndefined();
  });

  it("lets a signed-in cloud Studio write", async () => {
    await expect(
      assertStudioWritable({
        signInRequired: () => Promise.resolve(true),
        isSignedIn: () => true,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a signed-out cloud Studio with the sign-in copy", async () => {
    await expect(
      assertStudioWritable({
        signInRequired: () => Promise.resolve(true),
        isSignedIn: () => false,
      }),
    ).rejects.toBeInstanceOf(SignInRequiredError);
    await expect(
      assertStudioWritable({
        signInRequired: () => Promise.resolve(true),
        isSignedIn: () => false,
      }),
    ).rejects.toThrow(SIGN_IN_TO_CHANGE);
  });
});
