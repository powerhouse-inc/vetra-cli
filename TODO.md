# TODO
- manage installed packages (vetra-studio-package-install)?
- Make npm login reliable
- Generalize spec commands to work on any document model

## Spec ownership migration
Goal: vetra-cli owns the spec-document workflow; drop `@powerhousedao/vetra/codegen` coupling.

Motivation: we needed spec lookups (`spec-get`/`spec-update`/`spec-delete`/`spec-generate`) to accept `name | slug | id`, which required `spec-create` and `spec-extract` to actually populate `header.slug` (upstream `createDocument` leaves it `""`). The slug invariant currently lives only on the vetra-cli side of the upstream boundary, so any future caller going through `@powerhousedao/vetra/codegen` directly can still produce slug-less docs. Owning spec creation here makes the invariant universal.

- Inline a spec FS layer in vetra-cli (`getDocument(s)WithPaths`, `saveSpec`, `deleteDocument`, `specPath`/`specDir`, registry via `listSpecDocumentTypes`/`getSpecEntry`, `createDocument`, `addActions`/`validateActions`). Keep importing reducers/factories/jsonSpecs from the public `@powerhousedao/vetra/document-models/*` exports.
- Have the new `getDocuments` return `{ doc, path }` pairs so `findByName` no longer recomputes paths via `specPath` — fixes the wrong-file delete bug surfaced when two docs share a kebab-name but live under different extensions (`.editor.phd` vs `.phdm.phd`).
- Move `extract*Documents` + `generate*FromDocument` adapters in too, so vetra-cli's `spec-extract`/`spec-generate` no longer reach into vetra/codegen.
- Once vetra-cli is self-sufficient, decide ph-cli's fate:
  - Option A: drop spec notion from ph-cli entirely (`--extract`/`--document` flags on `generate-*` commands go away). Direct codegen via args/JSON stays. Users use `vetra spec-extract`/`vetra spec-generate` for spec flows.
  - Option B: keep ph-cli `--document` by inlining the `.phd` loader there too — `document-model/node`'s `baseLoadFromFile` plus the 5 trivial `generate*FromDocument` wrappers. No vetra dep.
- After ph-cli is detached, remove `@powerhousedao/vetra` from ph-cli's dependencies.

### Local workarounds in place until the migration lands
- `spec-create` and `spec-extract` patch `doc.header.slug = slugify(name)` after calling upstream `createDocument`/`extract*Documents`. Upstream's factories still emit `slug: ""`, so any consumer that bypasses these two commands will keep producing slug-less docs (current `spec-list` shows `—` for legacy specs that predate the patch). Folding slug into the inlined `createDocument` will remove this patch.
- `findByName` in `vetra-cli/src/commands/spec/_helpers.ts` ships its own `iterateSpecFiles` / `getDocumentsWithPaths` pair that duplicates upstream's `getDocuments` loop just to keep the on-disk path (and to enable the filename-fast-path lookup that avoids loading every spec on every command). The walkers become the canonical `getDocuments` once we own the FS layer; delete the local pair then.