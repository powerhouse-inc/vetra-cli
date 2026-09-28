import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingMutationSchema } from "./is-missing-mutation-schema.mjs";

const FIELD = "renown_issueCredential";
const INPUT_TYPE = "RenownCredential_InitInput";

function errorWith(message) {
  return { graphQLErrors: [{ message }] };
}

test("old server: unknown mutation field falls back", () => {
  assert.equal(
    isMissingMutationSchema(
      errorWith(`Cannot query field "${FIELD}" on type "Mutation".`),
      FIELD,
      INPUT_TYPE,
    ),
    true,
  );
});

test("old server: unknown input type falls back", () => {
  assert.equal(
    isMissingMutationSchema(errorWith(`Unknown type "${INPUT_TYPE}".`), FIELD, INPUT_TYPE),
    true,
  );
});

test("real coercion failure mentioning the input type does not fall back", () => {
  assert.equal(
    isMissingMutationSchema(
      errorWith(
        `Variable "$input" got invalid value {}; Expected type "${INPUT_TYPE}" to be an object.`,
      ),
      FIELD,
      INPUT_TYPE,
    ),
    false,
  );
});

test("resolver-level invalid request does not fall back", () => {
  assert.equal(
    isMissingMutationSchema(
      errorWith("Invalid request: missing @context"),
      FIELD,
      INPUT_TYPE,
    ),
    false,
  );
});

test("rate limited does not fall back", () => {
  assert.equal(
    isMissingMutationSchema(errorWith("Rate limited"), FIELD, INPUT_TYPE),
    false,
  );
});

test("forbidden does not fall back", () => {
  assert.equal(
    isMissingMutationSchema(errorWith("Forbidden"), FIELD, INPUT_TYPE),
    false,
  );
});
