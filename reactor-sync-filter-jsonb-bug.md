# `touchChannel` / sync-remote upsert fails on Postgres with a non-empty `documentId`/`scope` filter

## Summary

Registering a sync remote whose `RemoteFilter` has a **non-empty `documentId` (or `scope`) array** fails on a real-Postgres-backed reactor with:

```
invalid input syntax for type json
```

surfaced through the GraphQL `touchChannel` mutation as:

```
Failed to create channel: invalid input syntax for type json
```

An **empty** filter (`documentId: []`) succeeds. The failure does **not** reproduce on PGlite-backed reactors (PGlite tolerates the malformed bind), so it only appears on deployed switchboards using real Postgres.

## Affected code

- `@powerhousedao/reactor` — `KyselySyncRemoteStorage.remoteRecordToRow` in
  `packages/reactor/src/storage/kysely/sync-remote-storage.ts`.
- Reached via `@powerhousedao/reactor-api` — `touchChannel` resolver in
  `packages/reactor-api/src/graphql/reactor/resolvers.ts`, which calls
  `ISyncManager.add(...)` → the storage upsert above.

Observed on `reactor-api@6.0.0-dev.258`. The same code path is present and
unchanged in the current monorepo (`@powerhousedao/reactor@6.2.0-dev.28`), so it
is not fixed there.

## Root cause

`sync_remotes.filter_document_ids` and `filter_scopes` are **`jsonb`** columns
(`packages/reactor/src/storage/migrations/010_create_sync_tables.ts`).
`remoteRecordToRow` binds the raw JS arrays directly:

```ts
filter_document_ids:
  remote.filter.documentId.length > 0 ? remote.filter.documentId : null,
filter_scopes: remote.filter.scope.length > 0 ? remote.filter.scope : null,
```

The Postgres driver serializes a JS **object** to JSON — which is why the
sibling `channel_parameters` `jsonb` column (an object) binds correctly — but
serializes a JS **array** to a Postgres array literal (`{a,b}`), which is not
valid JSON for a `jsonb` column. Hence `invalid input syntax for type json`.
With an empty array the value is stored as `null`, so the bug is hidden.

The object-vs-array asymmetry (`channel_parameters` works, `filter_document_ids`
does not) is a useful confirmation signal.

PGlite accepts the same bind, which masks the bug in local/dev and tests; only a
real Postgres backend rejects it.

## Reproduction

1. Run a switchboard/reactor backed by **real Postgres** (not PGlite).
2. Call the `touchChannel` mutation (authenticated) with a non-empty
   `documentId` filter:

   ```graphql
   mutation ($i: TouchChannelInput!) {
     touchChannel(input: $i) { success ackOrdinal }
   }
   ```
   ```json
   {
     "i": {
       "id": "repro-1",
       "name": "repro-1",
       "collectionId": "drive.main.<driveId>",
       "filter": { "documentId": ["<any-document-id>"], "scope": [], "branch": "main" },
       "sinceTimestampUtcMs": "0"
     }
   }
   ```

   → returns `Failed to create channel: invalid input syntax for type json`.

3. Repeat with `"documentId": []` → returns `success: true`.

Equivalently, `ISyncManager.add(name, collectionId, channelConfig, filter, options, id)`
with `filter.documentId = ["x"]` throws from the `sync_remotes` upsert.
`documentId: ["*"]` (the wildcard) fails the same way — it is still a non-empty
array.

## Impact

A consumer cannot register a **document-scoped** sync channel against a
Postgres-backed reactor: filtering a multi-document collection down to a subset
of document ids is impossible. Only "sync the entire collection" (empty filter)
works, which is unusable when a collection holds documents that a given client
must not receive.

## Suggested fix

JSON-encode the array columns before binding (or apply a consistent Kysely
jsonb-serialization plugin). In `remoteRecordToRow`:

```ts
filter_document_ids: remote.filter.documentId.length > 0
  ? sql`${JSON.stringify(remote.filter.documentId)}::jsonb`
  : null,
filter_scopes: remote.filter.scope.length > 0
  ? sql`${JSON.stringify(remote.filter.scope)}::jsonb`
  : null,
```

Correct on both real Postgres and PGlite. The read path
(`rowToRemoteRecord`, which reads `row.filter_document_ids` back as an array)
is unaffected, since `jsonb` round-trips the JSON array.

## Validation

After the fix, the reproduction above should return `success: true` with a
non-empty `documentId` filter on a Postgres backend, and the channel's
poll/push should honor the document filter. A regression test exercising the
`sync_remotes` upsert against real Postgres (not only PGlite) with a non-empty
`documentId`/`scope` filter would prevent recurrence.

## Re-verified (2026-06-23)

Still broken; not fixed in either location.

- **Live staging** (`switchboard.staging.vetra.io`, `reactor-api@6.0.0-dev.258`):
  `touchChannel` against `/graphql/r` returns `success: true` for
  `documentId: []` and `Failed to create channel: invalid input syntax for
  type json` for `documentId: ["*"]`. Runnable repro:
  `vetra-cli/scripts/repro-touchchannel-jsonb.ts`.
- **Current monorepo** (`@powerhousedao/reactor@6.2.0-dev.28`):
  `remoteRecordToRow` in `sync-remote-storage.ts` still binds the raw JS arrays
  (lines 56-58); `filter_document_ids`/`filter_scopes` are still `jsonb`
  (`010_create_sync_tables.ts` lines 15-16); the `PostgresDialect` is built with
  no JSON-serialization plugin (`reactor-builder.ts:889`). Code path unchanged
  since the issue was filed.

This blocks document-scoped environment sync in vetra-cli: a user must only
receive their own environment documents from the shared `powerhouse` drive,
which requires a non-empty `documentId` filter — the exact case that fails.
