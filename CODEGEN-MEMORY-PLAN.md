# spec-generate codegen — memory optimization plan

Plan to reduce the memory footprint of `vetra-cli`'s `spec-generate` (spec →
code) step. Built around **measure → change → re-measure → correctness-gate**:
each change is kept only if a reproducible peak drops AND generated output stays
identical.

Status: **Phase 0 executed and banked; optimization phases F1–F4 pending.**
The Phase-0 harness (`lab/measure-codegen.sh`) is built, the byte-identical
correctness gate is **proven usable** (gen/ identical across 15 runs), and the
baseline is locked: **B0 = 2111.5 MiB** median cgroup `memory.peak` (N=5,
dev.23, `--memory 4g`), median wall 26.35 s, gen hash
`e1bb37bcfc9f8258f89d70234afa1da6bb3167f4c9f48b6b7a60b71b6fb76278`. Phase 3
correctness gate chosen: **byte-identical generated output on the current
fixtures.**

This plan now sits inside a broader **vetra-cli memory-optimization workflow**
with independent levers (see §9): the codegen burst here (F1–F4) is one lever;
the Connect `externalize-vendor` change is a second lever targeting the
`reactor-project-start` Vite dev server.

---

## 1. Why — measured context

All numbers: `vetra-cli:0.0.1-dev.23`, amd64-under-qemu on an arm64 Mac,
`docker stats` working set + cgroup `memory.peak` (read-only; not resettable).

### Component footprints (isolated)

| Step | Footprint | Nature |
|---|---|---|
| Studio service idle (Connect + Switchboard + embedded reactor) | ~1.4 GiB | persistent |
| `reactor-project-init` (clone + offline pnpm) | ~1.1 GiB, ~6 s | transient |
| `reactor-project-start` (project's own reactor + Switchboard + Vite/Connect) | pushed cgroup peak 1.64 → 2.9 GiB | persistent while running |
| **`spec-generate`** (ts-morph AST + graphql codegen + tsc/eslint) | **B0 = 2111.5 MiB cgroup peak** (median N=5), ~26 s | transient burst |

> The earlier "~1.6 GiB" was `docker stats` working-set; the locked B0 of
> **2111.5 MiB** is the true cgroup `memory.peak` high-water on this host — the
> real number F1–F4 must beat. Absolute numbers are host-specific (amd64 under
> qemu, memory-constrained VM); compare phase deltas against B0 re-measured on
> the same host, not against these figures.

### Full interaction (real running container, dev.23)

- Idle (fresh boot): ~1.14–1.5 GiB.
- Settled after interaction: ~3.25 GiB (two reactors resident).
- **Peak (high-water): 5.21 GiB** — additive concurrency: main studio + the
  project reactor (from `reactor-project-start`) + the transient codegen burst,
  all in one cgroup, peaking while codegen runs.

(For reference, dev.19 ran slightly heavier than dev.23 across idle/settled/peak;
the version delta isn't the issue — the codegen burst is the lever here.)

**Conclusion:** the codegen burst is the optimizable transient that F1–F4
target. Of the two resident reactors, the `reactor-project-start` Vite/Connect
dev server is now addressed by a **parallel lever** — the Connect
`externalize-vendor` change (~1 GB / ~50% off that dev server; §9) — rather than
being wholly out of scope. The main studio service remains out of scope here.

---

## 2. Cost attribution of the ~1.5 GiB codegen burst

The burst is **stacked, sequential** (generators → `tsProject.save()` →
`runChecks` runs tsc fully, then eslint). The peak is the highest single stage
plus whatever is still resident at that moment.

### (a) ts-morph Project — dominant resident cost

`buildTsMorphProject` (in `@powerhousedao/codegen`, observed in installed
`dist/file-builders-BpFU1feu.mjs:6883`):

```js
new Project({ tsConfigFilePath: path.join(projectDir, "tsconfig.json"),
              skipFileDependencyResolution: true })
```

It does **not** pass `skipAddingFilesFromTsConfig` or `skipLoadingLibFiles` (both
default `false`), so the Project eagerly parses every file matched by the
generated tsconfig's `include: ["**/*"]` into an in-memory AST and loads the
bundled `lib.*.d.ts`. The package even defines the lighter
`DEFAULT_PROJECT_OPTIONS` / `getDefaultProjectOptions` (same file, ~line 6866)
with both skips on — but `buildTsMorphProject` ignores them.

### (b) graphql-codegen — secondary, transient

`generateTypesAndZodSchemasFromGraphql` (~line 7493) calls `@graphql-codegen/core`
`generate` with an in-memory SDL string built per document-model spec, running
the `typescript` plugin + `graphql-codegen-typescript-validation-schema` (Zod)
plugin + prettier, once per generated file. Bounded by spec count/size, not
project size.

### (c) tsc + eslint subprocesses — the stacking problem

`runChecks` (`vetra-cli/src/helpers/project-checks.ts`) spawns
`node_modules/.bin/tsc --noEmit --pretty false` then (sequentially)
`eslint --format json`, as child processes (ph-clint `processes.ts` `spawn`,
env inherits `process.env`), each with an **uncapped** default V8 heap. Their
heap is additive on top of the parent vetra process, which still holds the
not-yet-freed ts-morph AST. The generated tsconfig already sets
`skipLibCheck: true` and `incremental: true` (good).

**Net:** the 1.5 GiB is parent (ts-morph full-project AST + graphql closure)
**plus** an unbounded check subprocess, co-resident in one cgroup — stacking,
not one allocation.

---

## 3. Ranked optimizations

| # | Change | Repo | Risk | Expected impact |
|---|---|---|---|---|
| F1 | **Free the ts-morph project before `runChecks`** — drop the AST reference after `save()` so it GCs before tsc/eslint spawn. Apply in **`generate.ts` and `extract.ts`** (both build a Project via `buildTsMorphProject`) | vetra-cli `generate.ts`, `extract.ts` | low | removes the worst stacking term |
| F2 | **Cap tsc/eslint subprocess heaps** via `NODE_OPTIONS=--max-old-space-size` (env-overridable) | vetra-cli `node-memory.ts` + `project-checks.ts` | low | caps the additive child peak |
| F3 | **Lighten the ts-morph Project** — use the existing `DEFAULT_PROJECT_OPTIONS` (`skipAddingFilesFromTsConfig` + `skipLoadingLibFiles`) | **@powerhousedao/codegen** | med | **biggest lever** — cuts the dominant resident cost |
| F4 | **Cap the codegen parent heap** via `--max-old-space-size` (only after F1) | vetra-cli `vetra-run.sh` (image) | med | forces earlier GC; OOM risk if too low |

Ruled out: single-named-spec already avoids loading all docs
(`generate.ts`: `input.name ? [loadByName(...)] : getDocuments(...)`). tsc/eslint
already run sequentially (no concurrency to remove); `skipLibCheck` already on.

### F3 risk detail

Confirmed: `getPreviousVersionSourceFile` (`monorepo/packages/codegen/src/utils/source-files.ts:75`)
calls `project.getSourceFile(...)` with **no `addSourceFileAtPath` fallback**, so
`skipAddingFilesFromTsConfig` would make it return `undefined` and **silently
skip** the version-to-version copy/update in `document-model/src-dir.ts` and
`tests-dir.ts` — migration history is lost with no error. The safer fix is the
localized one: add `addSourceFileAtPath` before `getSourceFile` in that util.
**The single-version todo-list fixture cannot exercise this path at all**, so a
byte-identical F3 gate on it is necessary but **not sufficient** — a
multi-version fixture (v1/v2/v3 model) is a hard precondition before trusting
F3. This is why F3 is gated hardest and kept a human-judgment keep decision.

---

## 4. Workflow phases

Each phase: implement in an isolated git worktree → rerun the harness → diff
generated output against the Phase-0 snapshot → keep only if peak drops and
output is identical. Phase numbers map to the finding IDs above.

- **Phase 0 — baseline harness** (see §5). Lock a reproducible number + an
  output snapshot before any change.
- **Phase 1 — F1** (free-before-checks, vetra-cli). Low risk; land first.
- **Phase 2 — F2** (cap check subprocess heaps, vetra-cli). Already demoed (see
  §6). Land, re-measure.
- **Phase 3 — F3** (lighten ts-morph, `@powerhousedao/codegen`). Cross-repo,
  highest leverage, hardest gate. Do not start until Phases 1–2 are banked.
- **Phase 4 — F4** (cap parent heap, vetra-cli image). Last — a global ceiling
  only safe once F1 reduces what must fit.

Order rationale: bank the low-risk vetra-cli wins first to establish a clean
intermediate baseline, then tackle the cross-repo, higher-risk F3 against it;
F4 last because it's a hard ceiling.

---

## 5. Phase 0 — measurement harness (the gate)

**Built and run — `lab/measure-codegen.sh` (untracked; commit when stable).**

- **Fixture:** the existing reactor project at
  `/Users/acaldas/dev/powerhouse/vetra/vetra-test/todo-list/` (workspace root —
  **not** under `vetra-cli/`). It already has `specs/` (1 document-model + 1
  editor) and a generated `gen/` tree, so the harness copies it, clears `gen/`,
  and regenerates — **no `reactor-project-init` / registry clone needed**, which
  isolates the codegen burst cleanly.
- **Run:** fresh container per run (`memory.peak` isn't resettable), through the
  image entrypoint `vetra-run.sh`, which **already exports `NODE_PATH`** (commit
  `7d1f511`) so the Zod validation-schema plugin resolves. Invocation:
  `vetra --workdir /work spec-generate --project todo-list` — `--workdir` **must
  precede** the subcommand (Commander `enablePositionalOptions`); after it, the
  flag errors and under-measures (~520 MiB).
- **Record per run:** cgroup `memory.peak`, wall time, sha256 of `gen/`.
- **Gate hardened:** a run is **rejected** (not recorded) if codegen errored
  early, OOM'd, exited non-zero, the peak is missing, or the tsc/eslint checks
  didn't actually run. The last guards a real trap: a *nested* bind-mount of
  `node_modules` under the `/work` mount is intermittently invisible on macOS
  virtiofs, silently skipping the tsc/eslint subprocesses (the dominant peak
  term) and faking a ~616 MiB low — fixed by mounting at top-level `/nm` with a
  symlink.
- **Determinism: HOLDS** — `gen/` byte-identical across 15 runs, so the
  byte-identical correctness gate is automatable.
- **Result:** B0 = 2111.5 MiB median peak / 26.35 s wall (N=5). B0 JSON at
  `/tmp/codegen-measure/baseline.json`.
- The one-shot proxy fix (ph-clint `325ea4f`) means `vetra spec-generate`
  doesn't bind :8090, so it can also be measured *inside* a live studio
  container — that concurrent reading is the §9 cross-lever confirm, not the
  per-phase gate.

### Correctness gate (Phase 3 especially) — **byte-identical on current fixtures**

1. Generated `gen/` tree must be **byte-identical** to the Phase-0 snapshot
   (todo-list fixtures).
2. Post-gen tsc + eslint must still pass (no new errors).

(Note: byte-identical on the current 2-spec fixture only. It does not exercise
multi-version / cross-file generators; if F3 later ships more broadly, add a
multi-model/multi-version fixture before trusting the skip-files change.)

---

## 6. Already demoed (F2)

Phase 2 / F2 was implemented in a subagent worktree (not committed, not in main
tree):

- `vetra-cli/src/helpers/node-memory.ts` — added `checkNodeOptions()` (default
  1024 MB, `VETRA_MEM_CHECK_MB` override), matching the existing per-role cap
  pattern (cf. `phInitNodeOptions()`).
- `vetra-cli/src/helpers/project-checks.ts` — widened `RunProcess` opts to accept
  `env`, pass `NODE_OPTIONS: checkNodeOptions()` to both the tsc and eslint
  spawns.
- Typechecks clean.

Worktree (may be GC'd): `.claude/worktrees/agent-a59785b251e7cda57`. Re-implement
in Phase 2 if gone.

---

## 7. Cross-repo mechanics

- **F1, F2, F4** are vetra-cli — worktree edits in this repo.
- **F3** is `@powerhousedao/codegen`. Source confirmed at
  `monorepo/packages/codegen/src/utils/ts-morph-project.ts` (`buildTsMorphProject`
  + the ignored `DEFAULT_PROJECT_OPTIONS`/`getDefaultProjectOptions`) and
  `source-files.ts` (`getPreviousVersionSourceFile`). Resolved via catalog
  `6.2.0-dev.16` with **no active `link:` override**. To measure: edit there,
  `pnpm --filter @powerhousedao/codegen build` (assert dist mtime changed — a
  stale dist masks the edit), add `link:monorepo/packages/codegen` to
  `pnpm-workspace.yaml` `overrides`, `pnpm install`, measure, then undo the link.
  Separate commit in that repo; keep per-repo concerns distinct.

---

## 8. Execution

Runnable workflow: `lab/execute-codegen-memory-plan.workflow.js` (Workflow tool).

**Measure each lever independently against B0, do not stack worktrees.** The
original "Phase N+1 baseline = Phase N's accepted state" can't work as
worktrees — `main` and the F2 demo worktree both sit at the same commit, so an
uncommitted phase can't be a baseline without committing to `main` between
phases. Instead: F1, F2, F3 each measured in their own worktree branched from
`main` vs B0; then a **combined** F1+F2(+F3) measurement (the real F2 signal,
since an isolated F2 can give a false negative — a capped tsc/eslint child OOMs
while the parent still holds the un-freed AST); then F4 on top of the kept
combination. Because the harness measures the **image**, each phase needs an
image rebuilt with its edit (F3 needs the link+dist rebuild regardless).

**Deterministic gate** (auto keep/revert): gen hash == B0 ∧ tsc+eslint pass ∧
median peak drop ≥ a set margin ∧ wall regression within tolerance. **Human
judgment** reserved for: the F4 ceiling value (OOM risk on larger projects than
the 2-spec fixture), and keeping F3 even on a green todo-list gate (the fixture
can't exercise `getPreviousVersionSourceFile`).

### Key file references

- vetra-cli: `src/commands/spec/generate.ts`, `src/commands/spec/extract.ts`,
  `src/helpers/project-checks.ts`, `src/helpers/node-memory.ts`, `Dockerfile`
  (`vetra-run.sh` generation).
- `@powerhousedao/codegen` (monorepo): `packages/codegen/src/utils/ts-morph-project.ts`
  (`buildTsMorphProject`, `DEFAULT_PROJECT_OPTIONS`, `getDefaultProjectOptions`),
  `packages/codegen/src/utils/source-files.ts` (`getPreviousVersionSourceFile`).
- Fixture: `/Users/acaldas/dev/powerhouse/vetra/vetra-test/todo-list/`.

---

## 9. Multi-lever workflow — the Connect `externalize-vendor` lever

The codegen burst (F1–F4) is one lever of a broader **vetra-cli
memory-optimization workflow**. The Connect `externalize-vendor` change is a
second, **independent** lever: it serves Connect + heavy deps from a prebuilt
vendor bundle in Vite dev, cutting the `reactor-project-start` Vite dev server
(~1 GB / ~50%) — a different term of the additive 5.21 GiB concurrent peak.

| | Codegen (F1–F4) | Connect (externalize-vendor) |
|---|---|---|
| Target | `spec-generate` transient burst | `reactor-project-start` Vite dev server (resident) |
| Baseline | B0 = 2111.5 MiB (locked) | reactor-start peak (~1.64→2.9 GiB) — to lock |
| A/B knob | source edit → rebuilt image per phase | `PH_CONNECT_EXTERNALIZE_VENDOR=1` env toggle (no rebuild) |
| Correctness gate | byte-identical `gen/` + tsc/eslint | Connect preview renders identically (no 404/missing-module/React err) |
| Arms | per-phase, stacked into combination | OFF / ON-warm / ON-cold (first-run vendor-build peak) |

Status of the Connect lever: branch `perf/connect-externalize-vendor` reviewed,
its blocker/high correctness gaps fixed and committed (versioned cache key,
atomic+locked build, graceful degradation, surfaced build errors). It is **inert
in vetra-cli** until `PH_CONNECT_EXTERNALIZE_VENDOR` is wired into the
`reactor-project-start` service env as a harness-controllable toggle.

Integration:
1. Shared harness core (fresh container → cgroup `memory.peak` → N=3 median →
   JSON) factored out of `lab/measure-codegen.sh`; add
   `lab/measure-reactor-start.sh` that boots `reactor-project-start`, drives the
   Connect preview to steady state, reads peak, A/B's the env.
2. Levers are independent processes → measure in parallel, each vs its own
   baseline. (Within the codegen lever, F1–F4 still follow §8.)
3. One **cross-lever concurrent confirm**: whole-container peak in a live studio
   across `{none, codegen-kept, connect-on, both}` vs the 5.21 GiB high-water —
   replaces both plans' separate "in-studio" steps, and (for Connect) doubles as
   the runtime `VENDOR_MODE` exercise the fix workflow flagged as untested.
4. Keep the per-lever correctness gates distinct (byte-identical vs
   preview-parity); the shared layer is the measurement discipline + the
   concurrent matrix.
