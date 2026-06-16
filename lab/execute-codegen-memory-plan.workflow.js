export const meta = {
  name: 'vetra-cli-memory-optimization',
  description: 'Multi-lever vetra-cli memory workflow: codegen burst (F1-F4) + Connect externalize-vendor, each measured vs its baseline, then a cross-lever concurrent confirm',
  phases: [
    { title: 'Baseline',   detail: 're-lock B0 on this host + confirm gen/ determinism' },
    { title: 'Codegen',    detail: 'F1 / F2 / F3 vs B0, combined F1+F2(+F3), F4 ceiling — sequential (VM can\'t run concurrent 4g measurements)' },
    { title: 'Connect',    detail: 'externalize-vendor A/B (OFF / ON-warm / ON-cold) on reactor-project-start' },
    { title: 'Concurrent', detail: 'whole-container peak: none / codegen-kept / connect-on / both vs 5.21 GiB' },
    { title: 'Synthesize', detail: 'keep/revert per lever + commit set + human-judgment items' },
  ],
}

// ---- grounded facts (from Phase-0 + reviews) ------------------------------
const VCLI_REPO = '/Users/acaldas/dev/powerhouse/vetra/vetra-cli'
const VCLI_PKG  = '/Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-cli'
const FIXTURE   = '/Users/acaldas/dev/powerhouse/vetra/vetra-test/todo-list'
const CODEGEN_SRC = '/Users/acaldas/dev/powerhouse/monorepo/packages/codegen'
const CONNECT_BRANCH = 'perf/connect-externalize-vendor'
const MEASURE_CODEGEN = `${VCLI_REPO}/lab/measure-codegen.sh`
const MEASURE_REACTOR = `${VCLI_REPO}/lab/measure-reactor-start.sh`
const DEV_IMAGE = 'cr.vetra.io/powerhouse-inc-powerhouse/clint-agent/vetra-cli:0.0.1-dev.23'

// deterministic gate thresholds
const KEEP_MIN_PEAK_DROP_MIB = 50
const MAX_WALL_REGRESS_PCT = 15

const MEASURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['label', 'ok', 'peakMiB', 'wallSec', 'correctnessPass', 'correctnessNote', 'erroredEarly', 'notes'],
  properties: {
    label: { type: 'string' },
    ok: { type: 'boolean', description: 'measurement ran cleanly (N=3 fresh containers, median)' },
    peakMiB: { type: 'number', description: 'median cgroup memory.peak, MiB (-1 if invalid)' },
    wallSec: { type: 'number' },
    correctnessPass: { type: 'boolean', description: 'codegen: gen hash == baseline + tsc/eslint pass; connect: preview renders identically (no 404/missing-module/React err)' },
    correctnessNote: { type: 'string' },
    erroredEarly: { type: 'boolean', description: 'codegen plugin/NODE_PATH resolve fail, or vendor build fail — invalidates the number' },
    notes: { type: 'string' },
  },
}

// =====================================================================
phase('Baseline')

const BASE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['determinismHolds', 'b0PeakMiB', 'b0WallSec', 'genHash', 'blockers', 'notes'],
  properties: {
    determinismHolds: { type: 'boolean' },
    b0PeakMiB: { type: 'number' },
    b0WallSec: { type: 'number' },
    genHash: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const base = await agent(
  `Re-lock the codegen baseline B0 on THIS host so phase deltas are host-consistent (absolute numbers are host-specific). Run ${MEASURE_CODEGEN} against the unchanged ${DEV_IMAGE} image, N=3 (it measures spec-generate on the ${FIXTURE} fixture through the image entrypoint). Confirm gen/ determinism (the 3 hashes identical). Return: determinismHolds, median b0PeakMiB, median b0WallSec, the gen hash, and any blockers. The prior locked B0 was ~2111.5 MiB / 26.35 s, hash e1bb37b… — flag if this run diverges materially.`,
  { label: 'baseline:relock-B0', phase: 'Baseline', schema: BASE_SCHEMA, effort: 'high' }
)

if (!base || !base.determinismHolds || (base.blockers || []).length) {
  log(`Baseline gate FAILED — stopping. blockers=${JSON.stringify(base?.blockers)}`)
  return { stoppedAt: 'baseline', base }
}
const B0 = base.b0PeakMiB, B0w = base.b0WallSec
const keep = (m) => !!m && m.ok && !m.erroredEarly && m.correctnessPass &&
  (B0 - m.peakMiB) >= KEEP_MIN_PEAK_DROP_MIB &&
  ((m.wallSec - B0w) / B0w) * 100 <= MAX_WALL_REGRESS_PCT
log(`B0 re-locked: ${B0} MiB / ${B0w}s, gen ${(base.genHash || '').slice(0, 12)}`)

// =====================================================================
phase('Codegen')
// Sequential: the VM cannot run concurrent 4g measurements. Each lever in its
// own worktree branched from main, image rebuilt with the edit, measured vs B0.

const F1 = await agent(
  `Codegen F1. In a worktree of ${VCLI_REPO} branched from main: in ${VCLI_PKG}/src/commands/spec/generate.ts drop the ts-morph Project reference (tsProject = null) right after 'await tsProject.save()' and before runChecks; apply the same in ${VCLI_PKG}/src/commands/spec/extract.ts. Build a vetra-cli image with this edit (prod-close build path), then run ${MEASURE_CODEGEN} pointed at that image. Return the measurement; correctnessPass = gen hash == B0 hash AND tsc+eslint pass.`,
  { label: 'codegen:F1', phase: 'Codegen', schema: MEASURE_SCHEMA, effort: 'high', isolation: 'worktree' }
)
log(`F1: ${F1?.peakMiB} MiB (Δ${(B0 - (F1?.peakMiB ?? B0)).toFixed(0)}), keep=${keep(F1)}`)

const F2 = await agent(
  `Codegen F2. In a worktree branched from main: add checkNodeOptions() to ${VCLI_PKG}/src/helpers/node-memory.ts (default 1024 MB, VETRA_MEM_CHECK_MB override, mirroring phInitNodeOptions); WIDEN the RunProcess type in ${VCLI_PKG}/src/helpers/project-checks.ts to accept env?: Record<string,string>; pass env:{NODE_OPTIONS: checkNodeOptions()} at BOTH the tsc and eslint call sites. Build an image, run ${MEASURE_CODEGEN}. NOTE in notes: an isolated F2 can be a false negative (capped child OOMs while the parent holds the un-freed AST) — the real signal is the F1+F2 combine.`,
  { label: 'codegen:F2', phase: 'Codegen', schema: MEASURE_SCHEMA, effort: 'high', isolation: 'worktree' }
)
log(`F2 (informational): ${F2?.peakMiB} MiB, keep=${keep(F2)}`)

const F3 = await agent(
  `Codegen F3 (cross-repo). In a worktree: (1) in ${CODEGEN_SRC}/src/utils/ts-morph-project.ts make buildTsMorphProject use DEFAULT_PROJECT_OPTIONS (skipAddingFilesFromTsConfig + skipLoadingLibFiles); (2) in ${CODEGEN_SRC}/src/utils/source-files.ts add an addSourceFileAtPath before getSourceFile in getPreviousVersionSourceFile (the no-fallback break); (3) build codegen dist and ASSERT its mtime changed; (4) link:${CODEGEN_SRC} into ${VCLI_REPO}/pnpm-workspace.yaml overrides, pnpm install, build a vetra-cli image; (5) run ${MEASURE_CODEGEN}; undo the link. In notes: byte-identical on the single-version todo-list fixture is necessary but NOT sufficient (can't exercise getPreviousVersionSourceFile) — flag F3 as a human-judgment keep.`,
  { label: 'codegen:F3', phase: 'Codegen', schema: MEASURE_SCHEMA, effort: 'high', isolation: 'worktree' }
)
log(`F3: ${F3?.peakMiB} MiB (Δ${(B0 - (F3?.peakMiB ?? B0)).toFixed(0)}), keep=${keep(F3)}`)

const f1ok = keep(F1), f3ok = keep(F3)
const combo = await agent(
  `Codegen combine. In a worktree branched from main, apply F1 (free tsProject in generate.ts + extract.ts) and F2 (checkNodeOptions + widened RunProcess + both call sites)${f3ok ? ' and F3 (linked codegen with DEFAULT_PROJECT_OPTIONS + the getPreviousVersionSourceFile fallback, dist rebuilt, link in pnpm-workspace.yaml)' : ''} together. Build an image, run ${MEASURE_CODEGEN}. This is the real F2 signal. Return measurement vs B0 (${B0} MiB).`,
  { label: 'codegen:combine' + (f3ok ? '+F3' : ''), phase: 'Codegen', schema: MEASURE_SCHEMA, effort: 'high', isolation: 'worktree' }
)
log(`combine: ${combo?.peakMiB} MiB (Δ${(B0 - (combo?.peakMiB ?? B0)).toFixed(0)}), keep=${keep(combo)}`)

let F4 = null
if (f1ok && keep(combo)) {
  F4 = await agent(
    `Codegen F4. From the combined F1+F2${f3ok ? '+F3' : ''} change, add a parent-heap cap via --max-old-space-size in the codegen path (${VCLI_PKG}/Dockerfile vetra-run.sh generation), VETRA-overridable. Build an image at a candidate ceiling, run ${MEASURE_CODEGEN}. In notes: state the ceiling tried and that the 2-spec fixture cannot prove it safe on larger projects (human-judgment item).`,
    { label: 'codegen:F4', phase: 'Codegen', schema: MEASURE_SCHEMA, effort: 'high', isolation: 'worktree' }
  )
  log(`F4: ${F4?.peakMiB} MiB at candidate ceiling, keep=${keep(F4)}`)
} else {
  log('Skipping F4 — combination did not pass its gate (F4 only safe on top of a banked F1).')
}

// =====================================================================
phase('Connect')
// externalize-vendor A/B on the reactor-project-start Vite dev server.
// Env toggle (no per-arm rebuild); OFF arm is the baseline.

const connect = await agent(
  `Connect lever — externalize-vendor A/B on reactor-project-start. Prep: build the monorepo ${CONNECT_BRANCH} (builder-tools) and link it into a vetra-cli image; the env toggle is already wired into the reactor-project-start service (PH_CONNECT_EXTERNALIZE_VENDOR, harness-controllable). Then run ${MEASURE_REACTOR} with three arms: OFF (env unset = baseline), ON-warm (env set, .ph-vendor prebuilt), ON-cold (env set, .ph-vendor absent — captures the first-run vendor-build subprocess peak). One fresh container per run, N=3 median each.
Return a SINGLE measurement object summarizing the win: set peakMiB = ON-warm median, and in notes give all three arm medians (OFF / ON-warm / ON-cold) + startup peaks + the Δ vs OFF. correctnessPass = the Connect preview renders identically in ON vs OFF (no missing-module/import-map 404s, no "no named export" React errors) — this is the gate that catches stale-cache / false-fallback regressions. erroredEarly = vendor build failed.`,
  { label: 'connect:externalize-vendor-AB', phase: 'Connect', schema: MEASURE_SCHEMA, effort: 'high' }
)
log(`Connect: ON-warm ${connect?.peakMiB} MiB, correctness=${connect?.correctnessPass}; ${connect?.notes?.slice(0, 120)}`)

// =====================================================================
phase('Concurrent')
// Whole-container peak in a live studio: do the isolated wins translate?

const CONC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['arms', 'notes'],
  properties: {
    arms: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['arm', 'peakMiB'],
        properties: { arm: { type: 'string' }, peakMiB: { type: 'number' }, note: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const concurrent = await agent(
  `Cross-lever concurrent confirm. In a LIVE studio container (the ph-clint one-shot proxy fix lets spec-generate run without binding :8090), measure the whole-container cgroup memory.peak under four arms, one fresh container each: (1) none = stock dev.23; (2) codegen-kept = image with the kept codegen changes (combine${f3ok ? '+F3' : ''}${F4 && keep(F4) ? '+F4' : ''}); (3) connect-on = stock + PH_CONNECT_EXTERNALIZE_VENDOR=1 wired into reactor-project-start (branch linked); (4) both. Drive a representative interaction (reactor-project-start up + a spec-generate) so the peak reflects the additive 5.21 GiB scenario. Report each arm's peak and how the levers compose vs the 5.21 GiB high-water — do the isolated deltas translate?`,
  { label: 'concurrent:matrix', phase: 'Concurrent', schema: CONC_SCHEMA, effort: 'high' }
)

// =====================================================================
phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['codegenKeep', 'connectVerdict', 'concurrentDelta', 'commitSet', 'humanJudgmentItems', 'bottomLine'],
  properties: {
    codegenKeep: { type: 'array', items: { type: 'string' } },
    connectVerdict: { type: 'string' },
    concurrentDelta: { type: 'string' },
    commitSet: { type: 'array', items: { type: 'string' }, description: 'repo-scoped commits (vetra-cli vs monorepo separate)' },
    humanJudgmentItems: { type: 'array', items: { type: 'string' } },
    bottomLine: { type: 'string' },
  },
}

const synth = await agent(
  `Synthesize the vetra-cli memory-optimization run into keep/revert + a commit plan.
B0 = ${B0} MiB / ${B0w}s.
Codegen per-lever: ${JSON.stringify({ F1, F2, F3, combo, F4 }, null, 2)}
Connect A/B: ${JSON.stringify(connect, null, 2)}
Concurrent matrix: ${JSON.stringify(concurrent, null, 2)}

Keep a codegen lever only if its (or the combination's) gate passed: gen hash == B0, tsc+eslint pass, median peak drop >= ${KEEP_MIN_PEAK_DROP_MIB} MiB, wall regression <= ${MAX_WALL_REGRESS_PCT}%. For Connect, keep if ON-warm shows a material peak drop AND the preview-parity gate passed. Commits must be repo-scoped (vetra-cli edits vs the monorepo codegen edit are SEPARATE commits; the Connect fixes are already committed on ${CONNECT_BRANCH}). Human-judgment items: F3 trust on a single-version fixture (needs multi-version fixture), the F4 ceiling OOM risk, and whether to default PH_CONNECT_EXTERNALIZE_VENDOR on in reactor-project-start (product call). Note the ON-cold first-run penalty given reactor-project-start restarts often.`,
  { label: 'synthesize:decision', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' }
)

return { B0, base, codegen: { F1, F2, F3, combo, F4 }, connect, concurrent, synthesis: synth }
