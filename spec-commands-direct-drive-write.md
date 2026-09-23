# Plan: spec commands write the embedded drive directly

Status: **planned, not started.** Pick this up in a future session.

## Goal / context

Today the spec write commands (`spec-create`, `spec-update`, `spec-delete`,
`spec-extract`) only write the filesystem (`<project>/specs/<subdir>/*.phd` via
`registry.saveSpec`). The embedded `vetra` drive that Vetra Studio reads is
updated **indirectly** by the `spec-fs-sync` chokidar watcher (FS → drive). That
round-trip is fragile (we just fixed a chain of watch-root / glob / snapshot-vs-ops
bugs) and asynchronous.

We want command-originated spec changes to update the embedded drive **directly
and synchronously** when a reactor is running, so Studio reflects them reliably
without depending on the watcher. The watcher stays but is demoted to detecting
**external** edits (hand-edited `.phd`, `git pull`, reactor-project writes).

### Hard constraint
The filesystem `specs/` is the **source of truth for codegen** and cannot be
abandoned:
- `spec-generate` reads it (`getDocuments` / `loadByName` from
  `@powerhousedao/vetra/codegen`, in `src/commands/spec/generate.ts`).
- The reactor-project's `ph vetra --watch` (started by `src/services/reactor-project.ts`)
  watches the FS for codegen + Vite HMR + BUILD-pane preview.

### Decisions (confirmed with user)
1. **Strategy: "Always FS + push drive."** Commands keep writing the `.phd` to the
   filesystem (unchanged) AND push to the embedded drive in the same call when a
   reactor is running. (Rejected the "drive-primary, spec-sync makes FS" variant —
   it introduces a codegen timing race.)
2. **Scope: all write commands** — create, update, delete, extract.
3. Read commands (`get`, `list`, `generate`, `schema*`) unchanged — FS stays
   canonical and is always current because commands still write it synchronously.

## Verified technical facts (no need to re-research)

- `CommandContext` (`ph-clint .../dist/core/types.d.ts`) exposes:
  - `reactor?: () => Promise<ReactorContext|undefined>` — **lazily boots** the
    reactor on first call. Must NOT be called blindly in one-shot CLI (would spin
    up a full reactor just to write a spec).
  - `folders?: FolderOperations` — wired **only** by the daemon's
    `startupSequence` and only when a personal drive exists.
- `buildDefaultReactor` gives the configured drive `role: 'personal'`
  (`ph-clint .../dist/integrations/powerhouse/index.js:40`), so the `vetra`
  drive (configured in `vetra-cli/src/cli.ts` `configureReactor`, name `vetra`,
  `preferredEditor: vetra-studio`) sets `personalDriveId`.
- Therefore **`context.folders` presence = "reactor running" signal**: present in
  the daemon, absent in one-shot mode — a non-booting check. When it's present,
  `await ctx.reactor()` returns the already-booted **cached** instance (no boot).
  Use `reactor.personalDriveId ?? reactor.driveId` for the drive id.
- One-shot vs daemon (`ph-clint .../dist/core/cli.js`, `runtime.js`): one-shot
  commands never run `startupSequence`; the reactor only starts if a command calls
  `ctx.reactor()`. Daemon (interactive `-i` / keep-alive) runs `startupSequence`
  which boots the reactor eagerly and sets `context.folders`.
- Drive-apply logic already exists and is tested in
  `vetra-cli/src/triggers/spec-fs-sync.ts`: `applyFsChangesToReactor(paths,
  workdir, reactor, driveId, log)` (materialize-if-absent → `loadBatch` content
  ops → `ensureProjectFolder` → `ensureFileNode`), plus `specForPath`,
  `projectForPath`, `materializeIfAbsent`, `getDriveActions`, `getDriveNodes`.
- Removal API (pattern from ph-clint `folders.js` `removeDocument`):
  `client.execute(driveId,'main',[deleteNode({id})])` + `client.removeRelationship(driveId,id,'child')`
  + `client.deleteDocument(id)`.
- Commands resolve `base = resolveReactorProjectPath(workdir, project)` then
  `registry.saveSpec(doc, base)` → returns the saved path under `base/specs/`.
  `registry.ts` is the merged registry (codegen builder specs + vetra-app domain
  models like brand-sheet); `resolveSpecEntry` / `createSpecDocument` /
  `applyActions` / `saveSpec` live there.

## Implementation steps

### 1. Extract shared module `src/helpers/spec-drive-sync.ts` (new)
Move from `src/triggers/spec-fs-sync.ts` (no behavior change): `specForPath`,
`projectForPath`, `loadSpecForFile`, `buildLoadJobsForFile`, `materializeIfAbsent`,
`getDriveActions`, `getDriveNodes`, `ensureProjectFolder`, `ensureFileNode`,
`applyFsChangesToReactor`, the `DriveNode`/`FsSyncLogger` types. Add:
- `removeSpecFromDrive(reactor, driveId, docId, log)` — deleteNode + removeRelationship
  + deleteDocument, guarded/idempotent (no-op if node/doc absent).
`spec-fs-sync.ts` keeps only the chokidar `setup`/`poll`/state + `SUBDIR_TO_SPEC`
and imports from the new module. Update test imports
(`tests/integration/spec-fs-sync.integration.test.ts`,
`tests/integration/spec-sync.integration.test.ts`) to the new module path where
they import `specForPath`/`projectForPath`/`applyFsChangesToReactor`/`buildLoadJobsForFile`.

### 2. Running-reactor accessor `src/helpers/embedded-drive.ts` (new)
```ts
export async function getEmbeddedDrive(ctx): Promise<{reactor; driveId}|undefined> {
  if (!ctx.folders) return undefined;                 // one-shot → no boot, FS only
  const reactor = await ctx.reactor?.();              // cached in daemon
  const driveId = reactor?.personalDriveId ?? reactor?.driveId;
  return reactor && driveId ? { reactor, driveId } : undefined;
}
```

### 3. Wire write commands (`src/commands/spec/`)
After the existing `saveSpec` (unchanged FS write):
- **create.ts / update.ts / extract.ts**: collect saved path(s), then
  ```ts
  const d = await getEmbeddedDrive(context);
  if (d) await applyFsChangesToReactor(paths, context.workdir, d.reactor, d.driveId, context.log);
  ```
- **delete.ts**: after removing the FS file (delete.ts resolves the doc + id),
  ```ts
  const d = await getEmbeddedDrive(context);
  if (d) await removeSpecFromDrive(d.reactor, d.driveId, docId, context.log);
  ```

### 4. Idempotency / no loops
Command FS write → `spec-fs-sync` watcher also fires → `applyFsChangesToReactor`
on the same file → materialize-if-absent skips, `loadBatch` dedups by `action.id`,
`ensureFileNode` dedups → convergent no-op. Direct drive write may trigger
`spec-sync` (drive→FS) to re-write identical FS content → idempotent. Redundant
churn but harmless; optional later optimization to suppress self-echo.

## Tests
- New `tests/integration/spec-command-drive.integration.test.ts`: reuse the
  in-memory reactor harness from `spec-fs-sync.integration.test.ts`
  (`driveDocumentModelModule` + `@powerhousedao/vetra` + `vetra-app` models, a
  `vetra` drive). Build a fake `context` =
  `{ workdir, folders: {} /* truthy */, reactor: async()=>({client, personalDriveId, driveId}), log }`
  and call the command `execute`:
  - create → drive has project folder + file node, doc gettable, state correct.
  - update → drive doc state reflects new actions; re-run idempotent (no dup ops/nodes).
  - delete → drive node + document removed.
  - `folders` absent → FS only, drive untouched, reactor not booted.
- Keep existing spec-fs-sync / spec-sync suites green after the extraction.

## Verification (live)
1. `pnpm test`, `npx tsc --noEmit`, `npx eslint` (run from `vetra-cli/vetra-cli`).
2. `pnpm dev`; agent: "create a brand sheet …". Immediately after the tool
   returns, `findDocuments(powerhouse/brand-sheet)` on `:59220` returns 1 and the
   `vetra` drive shows the project folder + file node — without depending on
   the `[spec-fs-sync]` watcher line.
3. `spec-generate` still works (FS written synchronously by the command).
4. Standalone `vetra spec-create …` (no daemon) writes FS only, does NOT boot a
   reactor (`context.folders` absent).

## Risks / notes
- Adds reactor round-trips to write commands — fine in the daemon/agent path.
- Redundant trigger churn (idempotent) as above.
- Separate, out-of-scope known bug: the embedded drive id changes on every daemon
  restart (`ensureDrive` in ph-clint not reusing the persisted `vetra` drive)
  — synced specs don't survive restarts.
- All changes in vetra-cli; no ph-clint edits.
- Update `ARCHITECTURE.md` (Preview flow / Triggers: commands write the drive
  directly; watcher = external-change detector) and `HANDOFF.md` (write path) when
  implementing.
