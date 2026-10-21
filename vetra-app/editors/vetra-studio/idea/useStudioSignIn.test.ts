import { describe, expect, it } from "vitest";
import { signInStatus } from "./useStudioSignIn.js";

describe("signInStatus", () => {
  it("is checking until the Studio's config is read", () => {
    expect(signInStatus(null, "authorized")).toBe("checking");
  });

  it("needs no sign-in on a Studio that runs on the customer's machine", () => {
    expect(signInStatus(false, "not-authorized")).toBe("signed-in");
  });

  it("follows Renown on a cloud Studio", () => {
    expect(signInStatus(true, "authorized")).toBe("signed-in");
    expect(signInStatus(true, "loading")).toBe("checking");
    expect(signInStatus(true, "checking")).toBe("checking");
    expect(signInStatus(true, "initial")).toBe("signed-out");
    expect(signInStatus(true, "not-authorized")).toBe("signed-out");
  });
});
