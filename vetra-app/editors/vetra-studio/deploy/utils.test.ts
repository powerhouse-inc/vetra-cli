import { describe, expect, it } from "vitest";
import { errorMessage, errorStatus, isAuthError } from "./utils.js";

/** graphql-request ClientError shape: response on the error, and a message
 * that embeds the full request + response as JSON. */
function clientError(status: number): Error {
  const err = new Error(
    `GraphQL Error (Code: ${status}): {"response":{"status":${status},"body":"{\\"error\\":\\"Credentials no longer valid\\"}"},"request":{"query":"mutation CreateEmptyDocument..."}}`,
  );
  (err as Error & { response?: unknown }).response = { status };
  return err;
}

describe("errorStatus", () => {
  it("reads the status from a ClientError response", () => {
    expect(errorStatus(clientError(401))).toBe(401);
  });

  it("falls back to parsing the message when response is missing", () => {
    expect(errorStatus(new Error("GraphQL Error (Code: 500): {...}"))).toBe(
      500,
    );
  });

  it("is null for plain errors and non-errors", () => {
    expect(errorStatus(new Error("boom"))).toBeNull();
    expect(errorStatus("boom")).toBeNull();
    expect(errorStatus(null)).toBeNull();
  });
});

describe("isAuthError", () => {
  it("is true only for 401", () => {
    expect(isAuthError(clientError(401))).toBe(true);
    expect(isAuthError(clientError(500))).toBe(false);
    expect(isAuthError(new Error("boom"))).toBe(false);
  });
});

describe("errorMessage", () => {
  it("passes through plain error messages", () => {
    expect(errorMessage(new Error("Signer has no address"))).toBe(
      "Signer has no address",
    );
    expect(errorMessage("boom")).toBe("boom");
  });

  it("never surfaces the raw API payload", () => {
    const msg = errorMessage(clientError(500));
    expect(msg).toBe("The cloud request failed (HTTP 500). Please try again.");
    expect(msg).not.toContain("query");
    expect(msg).not.toContain("body");
  });

  it("maps 401 to a re-login prompt", () => {
    expect(errorMessage(clientError(401))).toBe(
      "Your Renown session is no longer valid. Sign in again.",
    );
  });

  it("sanitizes a GraphQL error even without a parseable status", () => {
    expect(errorMessage(new Error("GraphQL Error: something odd"))).toBe(
      "The cloud request failed. Please try again.",
    );
  });
});
