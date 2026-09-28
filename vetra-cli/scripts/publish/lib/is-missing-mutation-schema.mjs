// True when `error` (thrown by the provisioning script's `gql()` helper, which
// attaches the raw `graphQLErrors` array) indicates the switchboard's schema
// predates `fieldName`/`inputTypeName` entirely, rather than a real request
// failure (bad input, rate limit, forbidden, ...). Two shapes count as
// "missing schema":
//   1. `Cannot query field "<fieldName>"` — the mutation itself isn't defined.
//   2. `Unknown type "<inputTypeName>"` — the mutation's input type isn't
//      defined. This message can also appear as *part of* a real variable
//      coercion failure (e.g. "Variable ... got invalid value ...; Expected
//      type RenownCredential_InitInput!, ..."), so it only counts when the
//      message does NOT also say "got invalid value" — that combination means
//      the type exists and the caller's input was malformed.
export function isMissingMutationSchema(error, fieldName, inputTypeName) {
  return Boolean(
    error?.graphQLErrors?.some((e) => {
      const message = typeof e?.message === "string" ? e.message : "";
      if (message.includes(`Cannot query field "${fieldName}"`)) return true;
      if (
        message.includes(`Unknown type "${inputTypeName}"`) &&
        !message.includes("got invalid value")
      ) {
        return true;
      }
      return false;
    }),
  );
}
