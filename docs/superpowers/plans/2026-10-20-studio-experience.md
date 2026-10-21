# Vetra Studio Experience (Projects 2 + 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Studio page with two states — a story while the product builds, the live product once it runs — where the first version goes live by itself, every later change is previewed next to live and launched with one click, and every launch is a version you can go back to without losing data.

**Architecture:** A new `vetra/studio-product` document in the Studio drive is the single read model for the page (strip, story chapters, versions); the agent writes it through a progress tool and tool wraps that record real check runs, so the strip can only show what happened. Launch and rollback run in the Studio agent process (git tag → publish → `vetra-apps` deploy → verify → mirror → record) and the cloud, never in the browser; the browser asks for them by writing request operations into the product document. The cloud gains Studio Apps without a GitHub repo, a Studio-bound agent launch path (D20), and later a single GitHub connection (the Deploy app) that mirrors launches.

**Tech Stack:** TypeScript; React (Connect editors, vitest) in `vetra-app`; Mastra 1.78 agents (input-step processors), ph-clint / clint-common (jest/vitest) in `vetra-cli` and ph-clint; Kysely/Postgres + Apollo subgraphs (vitest) in `vetra-cloud-package`; Next.js (vitest) in vetra.io; Kubernetes/ArgoCD values in `powerhouse-k8s-hosting`; Playwright staging harness.

**Spec:** `docs/superpowers/specs/2026-10-20-studio-experience-design.md` (this repo, branch `docs/studio-experience`, commit `92a711a`). Mockup the UI follows: `/home/f/projects/vetra-cli-openrouter/.superpowers/brainstorm/2040563-1792421608/content/hybrid.html`. Foundation context: `/home/f/projects/vetra-cli-foundation/docs/superpowers/plans/2026-10-19-studio-foundation.md` and its ledger `/home/f/projects/vetra-cli-foundation/.superpowers/sdd/2026-10-19-studio-foundation/progress.md` (rulings R1–R22).

**Open-question defaults (spec §11), each marked on the tasks that depend on it:** Q1 code lives only in the Studio until GitHub is connected · Q2 going live is included (no payment step) · Q3 anyone with the link can use the live product after Renown sign-in · Q4 prod after M3, M4 follows · Q5 the staging switchboard moves forward to the Studio's Powerhouse dev line.

## Workspaces

| Repo | Worktree | Branch | Base |
|---|---|---|---|
| vetra-cli (Studio: `vetra-cli` + `vetra-app`) | `/home/f/projects/vetra-cli-experience` | `feat/studio-experience` | `docs/studio-experience` (spec + plan travel with the code; it sits on `origin/main` = Studio `0.0.8-dev.8`) |
| ph-clint | `/home/f/projects/ph-clint-experience` (new: `git worktree add` from `/home/f/projects/ph-clint-foundation`) | `feat/steer-mid-turn` | `origin/main` (`36bc4aa`, 0.1.0-dev.107) |
| vetra-cloud-package | `/home/f/projects/vetra-cloud-package-experience` (new worktree) | `feat/studio-experience` | `feat/foundation` (`922e44c`) — see Ruling E2 |
| vetra.io | `/home/f/projects/vetra.io-experience` (new worktree) | `feat/studio-experience` | `origin/staging` |
| powerhouse-k8s-hosting | `/home/f/projects/powerhouse-k8s-hosting` | `main` (direct, config only) | — |
| Powerhouse monorepo (only if an upstream fix is needed) | `/home/f/projects/powerhouse-registry-fixes` | `fix/<topic>` | `origin/main` (6.2.3-dev.67) |
| Staging harness | `/home/f/.claude/jobs/81234be8/tmp/staging-e2e` | local git `main` (Task 0.2) | — |

## Global Constraints

- **Staging first, then prod**, for every service, image and Studio release; pin image tags only after the image exists. Prod rollout of the experience only after the staging harness passes G2–G8 (Q4 default: after M3).
- Every milestone ends with a staging release and a green acceptance run of the staging harness; the harness is the gate.
- **Existing Studios and their data survive** every change: document-model changes are additive (new operations/optional fields), shipped with upgrades; nothing is migrated silently; the upgrade only *adds* the product document and git tags.
- **Signatures:** cloud environment documents need v2 signatures and owner-only reducers stay owner-only; Studio-drive documents (product, chat, specs) use the legacy policy (R17). Any server-side launch path goes through `vetra-apps`' own authorised deploy path and never weakens env-document authorisation.
- **Rollback never rewrites or deletes documents. Ever.** Nothing deletes versions, environments, repos or documents automatically.
- **No secrets** in output, logs, commits, test fixtures, the product document or the browser (push tokens stay short-lived and server-side).
- **Public repos use neutral wording** (vetra-cli and ph-clint are public): no security language in commits/PRs.
- **Commits:** conventional; **no `Co-Authored-By` / "Generated with" trailers**. Pushes touching `.github/workflows` go over SSH (`git push git@github.com:<org>/<repo>.git HEAD:<branch>`); never `gh auth refresh`. **Never `git stash`** (shared stack) — use a WIP commit.
- **vetra.io changes go to `main` and `staging`.**
- Powerhouse train: the Studio's whole Powerhouse catalog (`@powerhousedao/*`, `document-model`, `@renown/sdk`, `ph-cmd`) is always one single version (R16); the staging switchboard/connect run that same version (Q5).
- **Budgets:** staging default **$10**/Studio/month, prod default **$1**, demo Studio **$50**; warning at **80%**; "Request more budget" from Foundation.
- **Each Studio signs in on its own stack's Renown** (staging `https://renown-staging.vetra.io`, prod `www.renown.id`) — R21; the preview keeps its own Renown namespace `vetra-studio-preview`.
- **Agent:** build requests build immediately without check-in questions, one-shot mode (R18/R19); `maxSteps` **80** stays the cap (R20).
- Output caps stay: main **8192**, sub-agents **16384**, memory **4096** tokens.
- **Customer-facing words never used on the main path:** environment, package, registry, Harbor, image, workflow, device code, approve changes, switchboard (allowed in Settings › Advanced).
- Copy is exact where the spec gives it (headings, buttons, failure lines) — tests assert the strings.
- Agent images build automatically on release; the nightly job bumps only the staging pool; the prod pool is pinned by hand.
- vetra-app document models follow the repo CLAUDE.md: reactor-mcp first (or R2: edit the model JSON + `ph-cli generate` when `ph vetra` is not running), errors via `ADD_OPERATION_ERROR`, reducers ≥ **95%** lines/branches/functions/statements, error tests via the operation-index pattern (never `.toThrow()`).

## Release recipes (referenced by the release tasks)

- **RR-ph-clint:** release commit bumping all six packages lockstep → PR to `powerhouse-inc/ph-clint` `main` → merge → `gh workflow run release.yml -R powerhouse-inc/ph-clint --ref main` (trusted publishing) → `npm view @powerhousedao/<pkg>@<v> version` for all six; `clint-common` and `ph-clint-app` may sit in npm "Validating" for a while — wait, do not republish (a re-publish 409s, ledger Task 5). Record the version in the ledger.
- **RR-studio:** branch `release/0.0.8-dev.N` (merge + version bump of `vetra-cli` and `vetra-app`) → PR to `powerhouse-inc/vetra-cli` → wait for CI incl. the **e2e (docker)** job (it must build without `CI=true` hangs: `npm_config_yes=true`) → merge → `gh workflow run release.yml -R powerhouse-inc/vetra-cli --ref main` → rerun failed publish steps on 409/504/E403 (`gh run rerun --failed`) → HEAD 200 for both tarballs on `registry.dev.vetra.io` and `registry.vetra.io` → wait for clint-image-builder job `build-vetra-<version>`; if the builder logged `ignored-type`, re-send `POST /webhook {"packageName":"vetra","version":"<v>"}` to the builder (or wait ≤ 15 min for reconcile) → k8s `tenants/staging/powerhouse-values.yaml` `STUDIO_POOL_VERSION: "<v>"` → a warm Studio Running 1/1, 0 restarts.
- **RR-cloud:** in a scratch worktree of `origin/staging`: merge `origin/main` (resolve only `package.json` `version` to staging's) if behind; merge `feat/studio-experience`; push; release run green → `0.0.x-staging.N` → k8s staging `PH_REGISTRY_PACKAGES: "@powerhousedao/vetra-cloud-package@<v>"` (both switchboard blocks) → switchboard Running, 0 restarts, new mutations visible by introspection, migrations applied (`\dt` in the namespace schema).
- **RR-web:** vetra.io: push to `staging`, wait for the staging deploy healthy, fast-forward `main` to the same commit, wait healthy.
- **RR-monorepo:** PR to `powerhouse-inc/powerhouse` `main` (neutral wording) → merge → dispatch the "Release Branch" prerelease → `6.2.3-dev.N` published (all catalog packages exist) → bump the Studio's whole catalog + overrides + `DEFAULT_PH_VERSION` to it (R16) and staging switchboard/connect to `v6.2.3-dev.N` (Q5).

## Test commands (the compressed "Step 1–4: tests → FAIL → implement → PASS" lines mean: write the named tests, run the command below and see them fail for the missing behaviour, implement, run again and see them pass with no new failures; record pre-existing failures before starting)

- vetra-app: `pnpm --filter vetra-app test -- <file pattern>`; coverage `pnpm --filter vetra-app test:coverage`; then `pnpm --filter vetra-app typecheck && pnpm --filter vetra-app lint`
- vetra-cli: `pnpm --filter vetra test -- <file pattern>`; then `pnpm --filter vetra typecheck` (known pre-existing: the 5 `--base`/codegen suites, ledger Task 6)
- ph-clint: `pnpm --filter @powerhousedao/clint-common test`, `pnpm --filter @powerhousedao/ph-clint test`, `pnpm -r run build`
- vetra-cloud-package: `pnpm vitest run <path>` and `npx tsc --noEmit -p .`
- vetra.io: `pnpm test:unit`, `pnpm -s tsc`, lint 0 errors
- harness: `node run.mjs --phase <list> [--studio <sub>] [--headed]`, result in `summary.json`

## Review Focus

1. **Auto-launch with broken data or code** — the first launch fires only after the Tests gate passed *in this change* (type check, lint, reducer tests, smoke render, seed documents valid against the models); a half-built or failing product never reaches the live URL. Test: Task 2.7 `auto-launch waits for a passing TESTS gate in the same change` and `seed documents that fail validation block the first launch`.
2. **Rollback losing documents** — Go back never writes to the product drive, never re-creates it, and is refused (with "Undo with the agent") when the drive uses an operation or document type the target version doesn't know. Test: Task 3.3 `rollback dispatches nothing to the product drive` and `rollback refused when the drive uses an operation added after the target`.
3. **Step strip lying about progress** — a step can't show ✓ without its gate, a ✓ step goes back to ◐ when the agent returns, and "~N min left" never goes negative or jumps back. Tests: Task 0.3 `COMPLETE_STEP TESTS without a passing check run in this change is rejected`; Task 1.7 `estimate switches to taking longer than usual instead of going negative`.
4. **GitHub organisation permission edge cases** — app installed on the org but repo creation restricted to owners, app not installed on the chosen org, caller no longer an org member, repo name taken; each shows plain words + next step and never blocks Live. Test: Task 4.1 `org repo creation restricted to owners maps to ORG_POLICY with the ask-an-owner message`.
5. **Budget exhaustion mid-build or mid-launch** — a build stopped by budget never auto-launches; a launch already running (no LLM needed) completes, the suggestions step is skipped without failing the launch, and the strip shows budget red with "Request more budget". Test: Task 2.7 `budget exhausted during launch: version goes live, suggestions skipped`.

---

## M0 — Ground

### Task 0.1: Staging platform on the Studio's Powerhouse line (default Q5)

**Files:**
- Modify: `/home/f/projects/powerhouse-k8s-hosting/tenants/staging/powerhouse-values.yaml:120,371` (switchboard + connect `tag: v6.2.3-dev.45` → `v6.2.3-dev.66`, the Studio catalog version in `pnpm-workspace.yaml`)
- Modify (only if Step 3 fails): `/home/f/projects/vetra-cloud-package-experience/package.json` Powerhouse deps → `6.2.3-dev.66`

**Interfaces:**
- Produces: staging switchboard + connect and the Studio client on one Powerhouse version; the deploy view no longer fails with `400 Cannot query field 'meta' on type 'PHDocument'`.

- [ ] **Step 1:** Confirm both images exist: `docker manifest inspect cr.vetra.io/powerhouse-inc-powerhouse/switchboard:v6.2.3-dev.66` and `…/connect:v6.2.3-dev.66` → manifests returned. If not, pick the newest dev tag that has both and run RR-monorepo's last step to move the Studio catalog to it first.
- [ ] **Step 2:** Take a DB snapshot note (migrations are forward-only): record the current staging switchboard migration list from its logs in the ledger. Change both tags; commit `staging: switchboard and connect to v6.2.3-dev.66 (Studio line)`; push.
- [ ] **Step 3:** Verify: switchboard pod Running, 0 restarts, migrations logged as applied; introspection lists `vetraApps`, `vetraLlm`, `vetraStudioPool` fields; a `__typename` query 200; `PHDocument { meta }` query no longer 400. If vetra subgraphs fail to load, bump the cloud package Powerhouse deps (file above) and release via RR-cloud.
- [ ] **Step 4:** Harness acceptance: `node run.mjs --phase login,deploy` → deploy phase records no HTTP 400 with `Cannot query field 'meta'`.

### Task 0.2: Harness under version control, metrics in the summary

**Files (harness root `/home/f/.claude/jobs/81234be8/tmp/staging-e2e`):**
- Create: `.gitignore` (`wallet.key`, `profile/`, `state.json`, `summary.json`, `artifacts/`, `node_modules/`, `*.log`, `gh-code.txt`, `old-*/`, `explore/`)
- Create: `lib/metrics.mjs`, `lib/product-doc.mjs`
- Modify: `run.mjs` (phase list), `phases/build-phase.mjs`, `README.md`

**Interfaces:**
- Produces: `readProductDoc(page): Promise<StudioProductState | null>` (reads the product document through the Studio's own switchboard GraphQL with the page's session; returns null when none); `recordMetrics(rec, { steps, costUsd, firstPreviewS, liveS })`; `summary.metrics` per phase; `budgetUsed(page): Promise<number | null>` (parses the strip/meter `$x of $y`).

- [ ] **Step 1:** `git init -q`, add `.gitignore`, `git add -A && git commit -m "chore: staging harness baseline"` — verify `git ls-files | grep -E 'wallet|profile|state.json'` prints nothing.
- [ ] **Step 2:** Implement `lib/metrics.mjs` and `lib/product-doc.mjs`; build phase records cost (budget before/after) and, once the product document exists (Task 0.3+), steps and timings from `changes[-1].metrics`.
- [ ] **Step 3:** Run `node run.mjs --phase build` against the current pool (dev.8) → `summary.json` contains `metrics.costUsd` and the baseline step count (from the chat transcript count for this baseline run). Save the numbers in the ledger as the G10 baseline.
- [ ] **Step 4:** Commit `feat: record cost and step metrics`.

### Task 0.3: `vetra/studio-product` document model — product and change modules

**Files:**
- Create (via reactor-mcp or R2 + `ph-cli generate`): `vetra-app/document-models/studio-product/studio-product.json`, `v1/schema.graphql`, `v1/src/reducers/product.ts`, `v1/src/reducers/change.ts`, `v1/tests/product.test.ts`, `v1/tests/change.test.ts`, `v1/tests/scenario.test.ts`
- Modify: `vetra-app/document-models/index.ts` (export), `vetra-cli/src/vetra-app-models.ts` (register `StudioProductV1`), `vetra-cli/src/agents/upgrade-manifests.ts` if models are listed there, `vetra-app/editors/vetra-studio/addAgentWritableDocument.ts` (legacy policy list gains `vetra/studio-product`)

**Interfaces:**
- Produces document type `vetra/studio-product`, extension `.vsp`, name `Studio Product`, global state:

```graphql
enum StepKind { PLAN DATA EDITORS TESTS LIVE }
enum StepStatus { NOT_STARTED WORKING DONE NEEDS_YOU STOPPED LIVE }
enum ChangeKind { FIRST_BUILD CHANGE UNDO BEFORE_VERSIONS }
enum ChangeStatus { BUILDING PAUSED READY LAUNCHING LAUNCHED DISCARDED FAILED }
enum CheckKind { GENERATE TYPECHECK LINT REDUCER_TESTS SMOKE }
enum ProductAccess { SIGNED_IN OWNER_ONLY }
type ProductStep { kind: StepKind! status: StepStatus! done: Int total: Int label: String reason: String updatedAt: DateTime }
type Milestone { id: OID! text: String! at: DateTime! recovered: Boolean! }
type CheckResult { kind: CheckKind! passed: Boolean! reason: String }
type CheckRun { id: OID! at: DateTime! results: [CheckResult!]! }
type Stuck { reason: String! tried: [String!]! at: DateTime! }
type ChangeMetrics { steps: Int! firstPreviewAt: DateTime readyAt: DateTime liveAt: DateTime }
type Change { id: OID! kind: ChangeKind! request: String! title: String chatSessionId: PHID status: ChangeStatus!
  startedAt: DateTime! steps: [ProductStep!]! milestones: [Milestone!]! checkRuns: [CheckRun!]! stuck: Stuck metrics: ChangeMetrics! }
type StudioProductState { name: String idea: String slug: String liveUrl: URL appId: String productionEnvironmentId: String
  productDriveId: String access: ProductAccess! changes: [Change!]! activeChangeId: OID }
```

- Operations (module `product`): `INIT_PRODUCT { name: String!, idea: String!, createdAt: DateTime! }` (errors `ProductAlreadyInitializedError`), `RENAME_PRODUCT { name: String! }`, `SET_ACCESS { access: ProductAccess! }`.
- Operations (module `change`): `START_CHANGE { id: OID!, kind: ChangeKind!, request: String!, chatSessionId: PHID, startedAt: DateTime! }` (sets `activeChangeId`; error `ChangeInProgressError` when the active change is BUILDING/PAUSED/READY/LAUNCHING — D13), `PLAN_STEPS { changeId: OID!, steps: [PlanStepInput!]! }` (`PlanStepInput { kind: StepKind!, total: Int }`), `START_STEP { changeId, kind, label: String, at }`, `COUNT_STEP { changeId, kind, done: Int!, total: Int! }`, `COMPLETE_STEP { changeId, kind, at }`, `REOPEN_STEP { changeId, kind, reason: String!, at }` (DONE → WORKING), `ADD_MILESTONE { changeId, id, text, recovered: Boolean, at }`, `RECORD_CHECK_RUN { changeId, id, at, results: [CheckResultInput!]! }`, `MARK_STUCK { changeId, reason, tried: [String!]!, at }`, `CLEAR_STUCK { changeId }`, `SET_STEP_ATTENTION { changeId, kind, status: StepStatus!, reason: String, at }` (only NEEDS_YOU / STOPPED / WORKING), `PAUSE_CHANGE { changeId, at }`, `RESUME_CHANGE { changeId, at }`, `RECORD_CHANGE_METRICS { changeId, steps: Int!, firstPreviewAt: DateTime, readyAt: DateTime }`, `SET_CHANGE_TITLE { changeId, title }`.
- Gates enforced in `COMPLETE_STEP` (error `GateNotMetError`): DATA needs a run in this change with GENERATE passed; EDITORS needs SMOKE passed; TESTS needs the latest run in this change with every result passed (GENERATE, TYPECHECK, LINT, REDUCER_TESTS, SMOKE all present). Errors `ChangeNotFoundError`, `StepNotPlannedError` everywhere a change/step id is resolved.
- Status rule: when every planned step of a FIRST_BUILD/CHANGE except LIVE is DONE, the change becomes READY (reducer, deterministic).

- [ ] **Step 1: Write failing reducer tests** — `INIT_PRODUCT twice is rejected`; `START_CHANGE while another change is building is rejected`; `COMPLETE_STEP TESTS without a passing check run in this change is rejected` (a passing run in an *earlier* change doesn't count); `COMPLETE_STEP TESTS after a run with all five kinds passed succeeds`; `COMPLETE_STEP DATA needs GENERATE passed`; `REOPEN_STEP moves DONE back to WORKING with the reason`; `change becomes READY when Plan Data Editors Tests are done`; a scenario test chaining INIT → START_CHANGE → PLAN_STEPS → steps/counts/milestones/check runs → READY; error tests for every error code via the operation-index pattern.
- [ ] **Step 2:** `pnpm --filter vetra-app test -- studio-product` → FAIL.
- [ ] **Step 3:** Create the model (reactor-mcp, R2 fallback), generate, implement reducers in `v1/src/reducers/{product,change}.ts`.
- [ ] **Step 4:** `pnpm --filter vetra-app test:coverage -- studio-product` → PASS, ≥ 95% on all four metrics; `pnpm --filter vetra-app typecheck`, `pnpm --filter vetra typecheck` clean.
- [ ] **Step 5:** Commit `feat(studio): studio-product document — product and change modules`.

### Task 0.4: Progress tool and recorded check runs

**Files:**
- Create: `vetra-cli/src/product/product-doc.ts`, `vetra-cli/src/commands/product/progress.ts`, `vetra-cli/src/commands/product/index.ts`, `vetra-cli/src/lifecycle/check-recorder.ts`, `vetra-cli/src/product/smoke.ts`
- Modify: `vetra-cli/src/cli.ts` (commands: `...productCommands`; lifecycle: `checkRecorder()` before `serializableToolErrors()`), `vetra-cli/src/commands/reactor-project/check.ts` + `src/helpers/project-checks.ts:256` (new input `tests?: boolean` — also runs the project's reducer tests (`vitest run` via its `test` script) and `runSmoke`; today the check runs only tsc + eslint)
- Test: `vetra-cli/tests/product/progress.test.ts`, `vetra-cli/tests/product/check-recorder.test.ts`, `vetra-cli/tests/product/smoke.test.ts`

**Interfaces:**
- Consumes: Task 0.3 operations.
- Produces: `getProductDoc(ctx): Promise<{ id: string; state: StudioProductState } | null>`, `dispatchProduct(ctx, actions: Action[]): Promise<void>` (embedded reactor, legacy-signed, Studio drive); tool `product-progress` with input `{ action: 'plan'|'start'|'count'|'done'|'back'|'milestone'|'stuck'|'suggest', step?: StepKind, steps?: {kind,total}[], label?, done?, total?, reason?, tried?: string[], text?, items?: string[] }` acting on the active change (`suggest` is wired in Task 3.4; until then it returns "not available yet"); a refused gate returns the reducer's message so the agent sees why. `checkRecorder()` wraps the tools and dispatches `RECORD_CHECK_RUN` with the results it actually observed: GENERATE from `spec-generate` / the codegen guard (`genGuard`) outcome; TYPECHECK and LINT from `reactor-project-check`; REDUCER_TESTS and SMOKE from `reactor-project-check { tests: true }`. `runSmoke(projectPath): Promise<CheckResult>` = SMOKE (Ruling E8).

- [ ] **Step 1: Write failing tests** — `progress plan creates steps on the active change`; `progress done TESTS returns the gate message when checks did not run`; `check-recorder records a failing TYPECHECK from a real check outcome` (fake command result with diagnostics); `check-recorder records nothing when the wrapped tool throws before running`; `smoke fails when the preview server returns a transform error for an editor module`; `smoke passes when the package builds and every editor module serves 200`.
- [ ] **Step 2:** `pnpm --filter vetra test -- product` → FAIL.
- [ ] **Step 3:** Implement. `runSmoke` = `ph build` of the package succeeds AND the preview server's Vite answers 200 without an error overlay payload for each editor/app module of the project.
- [ ] **Step 4:** Tests PASS; `pnpm --filter vetra typecheck` clean.
- [ ] **Step 5:** Commit `feat(agent): product progress tool and recorded check runs`.

### Task 0.5: Per-phase tool sets

**Files:**
- Create: `vetra-cli/src/agents/phase-tools.ts`
- Modify: `vetra-cli/src/agents/agent.ts:110-120` (main agent `inputProcessors: [new PhaseToolsProcessor(ctx), new TokenLimiterProcessor(...)]`)
- Test: `vetra-cli/tests/agents/phase-tools.test.ts`

**Interfaces:**
- Consumes: `getProductDoc` (Task 0.4).
- Produces: `ALWAYS_ON: string[]` (workspace read/list tools, `product-progress`, the skill tool, ask/answer tool, `whoami`); `PHASE_TOOLS: Record<StepKind | 'NONE', string[]>` as glob patterns — PLAN: `spec-*`; DATA: `reactor-project-init`, `reactor-project-check`, `reactor-project-build`, the reactor-mcp model tools, `agent-agentDocumentModel`; EDITORS: `spec-preview-*`, `reactor-project-start`, `reactor-project-check`, `agent-agentEditor`, `agent-agentApp`, reactor-mcp editor tools, workspace write/edit tools; TESTS: `reactor-project-check`, `reactor-project-build`, workspace write/edit tools; LIVE: none beyond ALWAYS_ON; NONE (no product or no active step): every tool (unchanged behaviour); `deploy-*` and `github-*` appear in no phase set (Settings › Advanced requests run with phase NONE). `class PhaseToolsProcessor` implements Mastra `processInputStep` returning `{ activeTools }` from the active change's WORKING step (a step that went back counts as the active one).

- [ ] **Step 1: Write failing tests** — `every registered tool is classified` (builds the real tool list from `cli` and asserts each name matches ALWAYS_ON or some phase or is in an explicit `ADVANCED_ONLY` list — forces a decision for new tools); `DATA step exposes model tools and hides editor tools`; `LIVE step exposes no deploy tools`; `no product document → all tools`.
- [ ] **Step 2–4:** Run (`pnpm --filter vetra test -- phase-tools`) → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `perf(agent): show the agent only the tools of the current step`.

### Task 0.6: Workflow prompt drives the strip; first conversation from the idea; debug panel

**Files:**
- Modify: `vetra-cli/prompts/agent-profiles/workflow.md` (call `product-progress plan` once the brief exists; `start`/`count`/`done` per step; `back` with a reason when returning; `milestone` for each finished thing in customer words; `stuck` after 3 failed attempts at the same thing; never claim Tests done — the tool checks), `vetra-cli/prompts/skills-tpl/deploy/*` (Studio products launch automatically; the deploy skill only serves explicit "deploy to my environment X" requests from Advanced)
- Create: `vetra-app/editors/vetra-studio/idea/startProduct.ts`, `vetra-app/editors/vetra-studio/debug/ProductDebugPanel.tsx`
- Modify: `vetra-app/editors/vetra-studio/VetraStudio.tsx` (temporary: when the drive has no product document and no chat session, the chat pane input calls `startProduct`; debug panel behind `?debug=product`)
- Test: `vetra-cli/tests/agents/workflow-progress.test.ts`, `vetra-app/editors/vetra-studio/idea/startProduct.test.ts`

**Interfaces:**
- Consumes: Task 0.3 ops; `addAgentWritableDocument` (legacy create, R17).
- Produces: `startProduct({ drive, idea, name? }): Promise<{ productId: string; sessionId: string }>` — creates the product document (`INIT_PRODUCT` name = first words of the idea until renamed by the agent), a chat session, `START_CHANGE { kind: FIRST_BUILD, chatSessionId }`, then `ADD_USER_MESSAGE` with the idea; idempotent if a product exists (returns it, starts nothing).

- [ ] **Step 1: Write failing tests** — `workflow tells the agent to plan steps with product-progress` (prompt contains the tool name and the five step names); `build-by-default regression still passes` (existing `tests/agents/build-by-default.test.ts`); `startProduct creates product, session and first change and sends the idea`; `startProduct on a drive with a product starts nothing`.
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS (`pnpm --filter vetra test`, `pnpm --filter vetra-app test`; always-loaded instructions stay ≤ 8 KB per `instructions-size.test.ts`).
- [ ] **Step 5:** One real-model run on a temporary $1 OpenRouter key (R3/R19 method, key never committed, deleted after): `create todo app product` → product document shows Plan→Data→Editors→Tests with milestones; record steps/cost in the ledger.
- [ ] **Step 6:** Commit `feat(studio): the agent fills the product document; first conversation starts from the idea`.

### Task 0.7: M0 release and acceptance

- [ ] **Step 1:** Harness: `phases/build-phase.mjs` reads the product document (Task 0.2 helpers) and records `steps`, `costUsd`, step timeline; fails if any Tests ✓ appears without a check run in the same change. Commit in the harness repo.
- [ ] **Step 2:** RR-studio → staging pool on the new version.
- [ ] **Step 3:** Acceptance: `BUILD_NEW_SESSION=1 node run.mjs --phase login,build` on a fresh Studio → preview reached; product document has all four build steps ✓ with milestones; steps < baseline (Task 0.2); record steps/cost/time in the ledger (first G10 data point).

---

## M1 — Story while it builds

### Task 1.1: Steering reaches the running turn (ph-clint)

**Files:**
- Create: `packages/clint-common/chat/steer.ts`
- Modify: `packages/clint-common/chat/chat-session-watch.ts:231-260,387-470` (a USER message arriving while a turn for that session is in flight is marked picked up and queued, not left for the next turn), `packages/clint-common/chat/index.ts` (export), `packages/ph-clint/src/integrations/mastra/index.ts:194-205` (stream options carry a `RequestContext` with `clint.threadId` = the chat session id)
- Test: `packages/clint-common/chat/steer.test.ts`, `packages/clint-common/chat/chat-session-watch.test.ts`

**Interfaces:**
- Produces: `enqueueSteer(threadId: string, message: { id: string; text: string }): void`, `drainSteers(threadId: string): { id: string; text: string }[]`, `createSteerProcessor(): Processor` (Mastra `processInputStep`: drains the queue for `requestContext.get('clint.threadId')` and appends each as a user message prefixed `Steering from the customer (apply now, confirm in one line): `), `hasInFlightTurn(threadId): boolean`. Steers left in the queue when the turn ends run as the next turn (nothing dropped).

- [ ] **Step 1: Write failing tests** — `a message during a turn is picked up within one poll and queued`; `the steer processor injects queued messages at the next step`; `steers left at turn end become the next turn`; `no steer is injected into another session's turn`.
- [ ] **Step 2–4:** `pnpm --filter @powerhousedao/clint-common test` and `pnpm --filter @powerhousedao/ph-clint test` → FAIL; implement; → PASS; `pnpm -r run build` clean.
- [ ] **Step 5:** Commit `feat(clint-common): messages sent during a turn steer it at the next step`.
- [ ] **Step 6:** RR-ph-clint → record version `0.1.0-dev.M`.

### Task 1.2: Studio on the new ph-clint; steer and pause wired

**Files:**
- Modify: `pnpm-workspace.yaml:40-43` (ph-clint packages → Task 1.1 version), `vetra-cli/src/agents/agent.ts` (main `inputProcessors` add `createSteerProcessor()` and `PauseProcessor`)
- Create: `vetra-cli/src/agents/pause.ts`
- Test: `vetra-cli/tests/agents/pause.test.ts`

**Interfaces:**
- Consumes: Task 1.1 exports; `PAUSE_CHANGE` / `RESUME_CHANGE` (Task 0.3).
- Produces: `class PauseProcessor` — at a step boundary, when the active change is PAUSED, aborts the turn cleanly (the story line "Paused — nothing is lost. Continue when you're ready." is written as a milestone by the processor); Continue = UI dispatches `RESUME_CHANGE` + user message `continue`.

- [ ] **Step 1–4:** Tests `pause stops after the current step, not mid-tool`, `resume continues the same change` → FAIL → implement → PASS; `pnpm install`, `pnpm -r typecheck`, `pnpm --filter vetra test`.
- [ ] **Step 5:** Commit `feat(agent): steer and pause apply at the next step`.

### Task 1.3: Supervisor — stuck, step cap, metrics, preview timeout

**Files:**
- Create: `vetra-cli/src/product/supervisor.ts` (trigger), `vetra-cli/src/product/supervisor-rules.ts` (pure)
- Modify: `vetra-cli/src/cli.ts` (triggers: `productSupervisorTrigger`)
- Test: `vetra-cli/tests/product/supervisor-rules.test.ts`

**Interfaces:**
- Produces: `evaluate(state: StudioProductState, chat: ChatSessionState, now: Date): SupervisorAction[]` with actions `markStuck` (no milestone for **5 min** while the turn runs, or the same failing check kind 3 runs in a row → `MARK_STUCK` with the tried lines), `autoContinue` (turn finished at the step cap with the change still BUILDING → send `continue` once; a second cap hit → `SET_STEP_ATTENTION NEEDS_YOU` "Taking a breather" + Continue), `previewSlow` (no SMOKE/first preview **60 s** after `reactor-project-start` → EDITORS NEEDS_YOU "The preview is taking longer than usual."), `recordMetrics` (steps from step-finish count, `firstPreviewAt`, `readyAt`).

- [ ] **Step 1–4:** Tests for each rule incl. `auto-continues once, then asks` and `does not mark stuck while a tool is still running` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): notice stuck builds, continue once at the step cap, record build metrics`.

### Task 1.4: Strip model and Studio shell (one page, three states)

**Files:**
- Create: `vetra-app/editors/vetra-studio/shell/StudioShell.tsx`, `shell/useStudioState.ts`, `strip/stripModel.ts`, `strip/StepStrip.tsx`, `settings/SettingsDialog.tsx`
- Modify: `vetra-app/editors/vetra-studio/editor.tsx` (render `StudioShell`), `VetraStudio.tsx` (kept only as the Settings › Advanced host for the old deploy/environment views), remove from the main path: `PhaseCycle`, `tour/*`, `LearnWhileYouWait`, `AutoNavToggle`, `useActivePhase`, `auto-nav` (delete files and their tests once unused)
- Modify: `vetra-cli/e2e/tests/*.spec.ts` (the release CI's Playwright e2e — source and docker jobs — drives the new shell: idea screen → Build it → preview renders; replay fixture unchanged)
- Test: `vetra-app/editors/vetra-studio/strip/stripModel.test.ts`, `shell/useStudioState.test.ts`

**Interfaces:**
- Consumes: product document (Task 0.3), `useStudioBudget` (Foundation).
- Produces: `studioState(doc | null): 'idea' | 'building' | 'live'` (idea: no product or product without changes; live: `liveVersion` set (added by Task 2.4; until then never); else building); `stripModel(doc, now): StripView` = `{ name, steps: { kind, icon: '○'|'◐'|'✓'|'!'|'✕'|'●', label, count?: string, clickable: boolean }[], right: { budget: string; timeLeft?: string } | { liveUrl: string; deployedAgo: string; github: string } }`; icons always paired with text; clicking a step opens its detail view (Plan → ideation docs read-only + Edit; Data → plain-words model view with "Show schema"; Editors → preview; Tests → check list; Live → live state).

- [ ] **Step 1: Write failing tests** — `strip shows working count 2/3 for DATA`; `a reopened step shows ◐ again`; `stopped step shows ✕ with text`; `no route other than strip steps, Settings and Versions` (G1: shell renders no tab/section buttons); `idea state when the drive has no product`.
- [ ] **Step 2–4:** `pnpm --filter vetra-app test -- strip shell` → FAIL; implement; → PASS; `pnpm --filter vetra-app typecheck && pnpm --filter vetra-app lint`.
- [ ] **Step 5:** Commit `feat(studio): one page with a step strip instead of tabs`.

### Task 1.5: Idea screen and sign-in round trip

**Files:**
- Create: `vetra-app/editors/vetra-studio/idea/IdeaScreen.tsx`, `idea/pendingIdea.ts`
- Test: `vetra-app/editors/vetra-studio/idea/IdeaScreen.test.tsx`

**Interfaces:**
- Consumes: `startProduct` (Task 0.6).
- Produces: exact copy — heading `What do you want to build?`, placeholder `Describe your product in a sentence or two — who it's for and what they do with it.`, button `Build it`, chips `Hotel breakfast orders`, `Maintenance requests`, `Invoice approvals` (fill only); top right `$10 to spend` (from the budget limit) + account menu; `savePendingIdea(text)` / `takePendingIdea()` in localStorage (try/catch); not signed in → Build it opens sign-in and the idea is restored after the redirect, then sent; first story line within 2 s: `Got it — planning <idea title>.` written as a milestone by `startProduct`.

- [ ] **Step 1–4:** Tests `chip fills the input without building`, `signed-out Build it stores the idea and opens sign-in`, `idea survives the sign-in round trip and is sent once`, `first story line appears immediately` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): blank idea screen`.

### Task 1.6: Story pane and steer box

**Files:**
- Create: `vetra-app/editors/vetra-studio/story/storyModel.ts`, `story/StoryPane.tsx`, `story/SteerBox.tsx`, `story/doingNow.ts`
- Modify: `vetra-app/editors/vetra-studio/ChatPane.tsx` (raw detail renderer reused for expanded lines)
- Test: `vetra-app/editors/vetra-studio/story/storyModel.test.ts`, `story/doingNow.test.ts`, `story/SteerBox.test.tsx`

**Interfaces:**
- Consumes: product document milestones/stuck/steps; chat-session messages (clint-common), `vetraToolRenderers`.
- Produces: `storyLines(product, change, chat, now): StoryLine[]` — idea in quotes first; one line per milestone (`✓`/`◐`, `⟲` for `recovered`), chat messages between two milestone timestamps folded under the earlier milestone; the agent's text replies as bubbles; questions highlighted with an answer box; `doingNow(lastToolCall): string` maps tool ids to plain words (`writing <file>…`, `running the checks…`, `starting the preview…`); `staleness(lines, turnState, now)` returns a waiting line when the newest line is > 30 s old while the agent works (G3). SteerBox placeholder `Steer it: "make slides 16:9"…`, always enabled while building, shows Foundation delivery state, Pause control next to it.

- [ ] **Step 1–4:** Tests `messages fold under the milestone before them`, `doing-now line names the file being written`, `a waiting line appears after 30 s without news`, `steer message shows sent then seen by the agent`, `Pause dispatches PAUSE_CHANGE and shows Continue` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): the build as a story you can steer`.

### Task 1.7: Preview pane, budget and time left

**Files:**
- Create: `vetra-app/editors/vetra-studio/preview/PreviewPane.tsx`, `preview/previewTabs.ts`, `strip/timeLeft.ts`, `strip/phase-averages.json`
- Modify: `vetra-app/editors/vetra-studio/BuildSection.tsx` (becomes the preview body), `budget/BudgetMeter.tsx` (strip variant: `$0.31 of $10`, amber ≥ 80%, red + Request more budget at 100%)
- Test: `preview/previewTabs.test.ts`, `strip/timeLeft.test.ts`

**Interfaces:**
- Produces: `previewTabs(project): { id, label, building: boolean }[]` (one per editor and app, the in-progress one labelled `building…`); skeleton copy `Setting up your project (about 30 s)…` then `Starting the preview…`, never a blank frame; follow-the-agent with chip `Following you · Back to the build`; hot reload keeps scroll position and the selected tab; `Restart preview` action for the NEEDS_YOU state from Task 1.3; `timeLeft(change, averages, now): string | null` — null before Plan is done; else `~N min left` = remaining planned units × per-phase averages, rounded up; once elapsed exceeds the estimate → `taking longer than usual`; monotone non-increasing while work completes (never jumps back up, never negative). `phase-averages.json` holds measured seconds per model / editor / check (Step 5).

- [ ] **Step 1–4:** Tests `estimate switches to taking longer than usual instead of going negative`, `estimate never increases when a unit completes`, `no estimate before the plan exists`, `tabs mark the in-progress editor as building` → FAIL → implement → PASS.
- [ ] **Step 5:** Fill `phase-averages.json` from the M0 harness runs (≥ 3 builds; ledger) — commit `feat(studio): preview tabs, budget and honest time left`.

### Task 1.8: Build-time failure states (G4)

**Files:**
- Create: `vetra-app/editors/vetra-studio/failures/failureStates.ts`, `failures/FailureLine.tsx`
- Test: `vetra-app/editors/vetra-studio/failures/failureStates.test.tsx`

**Interfaces:**
- Produces: `failureFor(product, chat, budget, preview): Failure | null`, `Failure = { situation, stripStep?: StepKind, stripIcon, text, actions: { label, run }[] }` for the build-time rows of spec §5.9 with exact copy: retried (`⟲ retried once on a backup model`), turn failed (`Stopped: the AI service didn't respond. Nothing you built is lost.` · Retry · Continue), stuck (`I'm stuck on <reason>. I tried <n> ways.` · Try a simpler version · Skip this part · Tell me how), step cap (`Taking a breather — continuing.` · Continue), budget 80% (`You've used 80% of this month's budget.`), budget used up (`Budget used up. Your work so far is saved.` · Request more budget), not delivered in 60 s (`Not delivered yet` · Retry), preview slow (`The preview is taking longer than usual.` · Restart preview), checks keep failing (`<n> checks still fail: …` · Let the agent try again · Go live anyway only when every failing result is LINT), signed out (sign-in modal, state kept), restarting (`Your Studio is restarting — back in a moment.`).

- [ ] **Step 1–4:** One test per situation asserting the text and that each action dispatches the right operation/message (G4), plus `Go live anyway is absent when a type check fails` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): every build failure says why and what to do next`.

### Task 1.9: Demo entry path fixes

**Files:**
- Modify: `/home/f/projects/vetra.io-experience/modules/cloud/studio/studio-embed-url.ts` + callers (pass the user's `did:pkh`, never the app `did:key`, or omit `?user=`), the vetra.io calls to `fetchBuilderAccount` / `fetchBuilderTeamsByMember` on the Studio path (skip when the switchboard lacks them — feature-detect once by introspection, no 400 in the console)
- Modify: `vetra-app` Connect model registration so `powerhouse/document-editor` loads (or the Studio's outer Connect stops listing it) — no "1 document type couldn't load" banner
- Test: `modules/cloud/__tests__/studio-helpers.test.ts` (vetra.io), `vetra-app/studio-connect-models.test.ts`

- [ ] **Step 1–4:** Tests `embed URL never carries a did:key as user`, `Studio Connect registers every document type it lists` → FAIL → fix → PASS (`pnpm test:unit`, `pnpm -s tsc` in vetra.io).
- [ ] **Step 5:** Commits `fix(studio): open the Studio with the user's identity` (vetra.io) and `fix(studio): no missing document type banner` (vetra-cli).

### Task 1.10: M1 harness phases, release and acceptance

**Files (harness):** Modify `phases/build-phase.mjs` (new UI: idea screen → Build it; samples strip + story every 10 s; asserts G3 freshness ≤ 30 s or a waiting line; sends one steer `add a priority field` at the first ◐ Editors and asserts a confirmation line and the field in the preview; records step-state timeline), Create `lib/strip.mjs` (`readStrip(page)` → `{ steps:[{kind,icon,count}], right }`).

- [ ] **Step 1:** Implement and commit harness changes.
- [ ] **Step 2:** RR-studio (carries Tasks 1.2–1.8) and RR-web (Task 1.9).
- [ ] **Step 3:** Acceptance on a fresh Studio: idea → preview on one screen, steering applied mid-build, no tab navigation, strip states monotone except announced back-steps, first preview ≤ 6 min (G2 part), G3 gaps none. Record in the ledger.

---

## M2 — Ships by itself

### Task 2.1: Studio launch secret (binding for D20)

**Files (cloud worktree):**
- Modify: `subgraphs/vetra-studio-pool/claim.ts:161-182` and the cold path (`create-env.ts`) — add `{ key: "VETRA_STUDIO_LAUNCH_SECRET", value: <32 random bytes hex> }` to the same batched write; store `sha256` in `studio_launch_secrets`
- Create: `subgraphs/vetra-apps/studio-binding.ts`; migration in `subgraphs/vetra-apps/db/migrations.ts` + `db/schema.ts` (`studio_launch_secrets(environment_id PK, secret_hash, rotated_at)`)
- Modify: `subgraphs/vetra-apps/schema.ts`, `resolvers.ts` (admin mutation `rotateStudioLaunchSecret(environmentId: String!): Boolean!` — rewrites the tenant config with the existing entries plus a new secret; used to backfill existing Studios)
- Test: `subgraphs/vetra-apps/__tests__/studio-binding.test.ts`, `subgraphs/vetra-studio-pool/claim.test.ts`

**Interfaces:**
- Produces: `verifyStudioBinding(deps, caller: Caller, presentedSecret: string | null, app: AppRow): Promise<void>` — passes only when `caller.appKey` is set (an agent did:key acting under the owner's current Renown delegation), `caller.address` acts for the App (owner, or org publisher per `canOperate`), `app.studio_environment_id` is set and `sha256(presentedSecret)` equals that Studio's stored hash; otherwise `FORBIDDEN` with message `This Studio can only launch its own product`. The agent sends the secret in header `x-vetra-studio-secret`.

- [ ] **Step 1–4:** Tests `claim writes the launch secret in the same batched write`, `binding refuses another Studio's secret`, `binding refuses an expired delegation`, `binding refuses a caller who no longer operates an org App`, `rotate keeps every other tenant entry` → FAIL → implement → PASS (`pnpm vitest run subgraphs/vetra-apps subgraphs/vetra-studio-pool`; `npx tsc --noEmit -p .`).
- [ ] **Step 5:** Commit `feat(apps): bind a Studio's agent to its own product`.

### Task 2.2: Studio products without GitHub — App and production environment (default Q1, default Q2)

**Files (cloud):**
- Modify: `subgraphs/vetra-apps/db/migrations.ts` (drop NOT NULL on `installation_id`, `repository_id`, `repository_full_name`; add `apps.product_drive_id text null`, `apps.product_access text not null default 'SIGNED_IN'`, `apps.launched_at text null`), `db/schema.ts`, `schema.ts` (`App.repository: AppRepository` nullable; `App.productDriveId`, `App.productAccess`), `service.ts` (new `ensureStudioProduct`; `createStudioApp` unchanged for repo creation, reused in M4), `resolvers.ts`, `watcher.ts` (sweep: Studio Apps never launched after **14 days** → soft-delete App, terminate its env — the only automatic deletion, of something the customer never saw live)
- Test: `subgraphs/vetra-apps/__tests__/studio-product.test.ts`, `migrations.test.ts`

**Interfaces:**
- Produces: mutation `ensureStudioProduct(input: { studioEnvironmentId: String!, name: String! }): App!` callable by the Studio agent path (Task 2.1 binding, via a Studio-scoped variant that loads the App by `studio_environment_id`) and by the owner; idempotent per Studio (returns the live App; the partial unique index `apps_studio_env_live` stays the guard). Creates: App row (`status: ACTIVE`, no repository, `identity_did` = the agent did:key, so the owner-only paths keep refusing the agent through `assertNotWorkload`, Harbor project reserved as today), production env with `genericSubdomain = slug` (slug of the name, taken → suffix; D19 fixed from now on), `SET_APEX_SERVICE CONNECT`, SWITCHBOARD + CONNECT enabled, owner = Studio owner (org Studio → org App), v2 path unchanged (system actions through `deps.envs`). Query `studioProduct(studioEnvironmentId: String!): App`. No licence/payment gate beyond the Studio's own (Q2).

- [ ] **Step 1–4:** Tests `creates an App without a repository and a production env at <slug>.vetra.io with Connect at the apex`, `second call returns the same App`, `slug taken gets a suffix`, `org Studio creates an org App`, `never-launched App is cleaned up after 14 days and a launched one never` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(apps): Studio products go live without GitHub`.

### Task 2.3: `launchStudioVersion` and `rollbackStudioVersion` (D20)

**Files (cloud):**
- Modify: `subgraphs/vetra-apps/db/migrations.ts` (`app_deployments.trigger text null`, `app_deployments.on_behalf_of text null`, `app_deployments.version_number int null`), `schema.ts` (enum `DeploymentTrigger { STUDIO_LAUNCH STUDIO_ROLLBACK OWNER CI }`; `AppDeployment.trigger`, `onBehalfOf`, `versionNumber`), `service.ts:2185-2250,2431-2567` (owner and CI paths record `OWNER` / `CI`), `resolvers.ts`, `watcher.ts:81-108`
- Test: `subgraphs/vetra-apps/__tests__/studio-launch.test.ts`

**Interfaces:**
- Consumes: `verifyStudioBinding` (2.1), `ensureStudioProduct` App (2.2), `performDeploy`.
- Produces: `launchStudioVersion(input: { appId: ID!, versionNumber: Int!, sha: String!, gitTag: String!, packages: [DeployedPackageInput!]!, productDriveId: String }): AppDeployment!` (PRODUCTION, `trigger STUDIO_LAUNCH`, `actorDid` = agent did, `onBehalfOf` = owner did:pkh; stores `productDriveId` on the App the first time and ignores it afterwards; that first time it also points the production env's Connect at the drive as its default drive through the env's service config, so `<slug>.vetra.io` opens the product, never an empty Connect home — Task 2.6 Step 1 confirms the config key) and `rollbackStudioVersion(deploymentId: ID!): AppDeployment!` (`trigger STUDIO_ROLLBACK`, only READY PRODUCTION deployments of the same App). Both refuse any caller failing the binding, any other App, and App identities (unchanged `assertNotWorkload` for owner paths). On FAILED of a Studio launch the watcher re-applies the previous READY deployment's packages once (`error` keeps the original reason) so the env never stays half-applied.

- [ ] **Step 1–4:** Tests `agent launches its own Studio's App and the deployment records trigger and owner`, `agent cannot launch another App`, `agent cannot roll back to a FAILED deployment`, `failed launch re-applies the previous versions`, `owner deployApp records trigger OWNER` → FAIL → implement → PASS.
- [ ] **Step 5:** Verify the env pipeline on staging (RR-cloud first if needed): force a FAILED launch with a non-existent package version on a throwaway Studio App → env returns to the previous package versions, READY. Record in ledger.
- [ ] **Step 6:** Commit `feat(apps): a Studio's agent launches and rolls back its own product`.

### Task 2.4: Product document — launch module

**Files:**
- Modify (reactor-mcp / R2): `vetra-app/document-models/studio-product/*` — new module `launch` + state fields; `v1/src/reducers/launch.ts`; `v1/tests/launch.test.ts`

**Interfaces:**
- Produces (additive): state `versions: [Version!]!`, `liveVersion: Int`, `health: LiveHealth!` (`UNKNOWN HEALTHY UNHEALTHY`), `pendingRequest: PendingRequest`, `launchPermission: PermissionState!` (`UNKNOWN GRANTED MISSING EXPIRED`); `Version { number: Int!, title: String!, summary: String, changeId: OID, gitTag: String!, sha: String!, packages: [PackageVersion!]!, deploymentId: String, launchedAt: DateTime, launchedBy: String!, trigger: String!, status: VersionStatus! (LAUNCHING LIVE PREVIOUS FAILED), lines: [LaunchLine!]!, changedFiles: [String!]!, failure: String }`, `LaunchLine { kind: LaunchLineKind! (SNAPSHOT PUBLISH DEPLOY VERIFY MIRROR), status: LineStatus! (WAITING RUNNING DONE FAILED SKIPPED), detail: String }`, `PendingRequest { kind: RequestKind! (LAUNCH ROLLBACK DISCARD), targetVersion: Int, requestedAt: DateTime!, requestedBy: String! }`. Ops: `SET_LIVE_TARGET { appId, productionEnvironmentId, slug, liveUrl }` (slug immutable once set: `SlugLockedError`), `SET_PRODUCT_DRIVE { driveId }` (once: `DriveAlreadySetError`), `REQUEST_LAUNCH { changeId, requestedAt, requestedBy }` (change must be READY: `ChangeNotReadyError`), `REQUEST_ROLLBACK { versionNumber, requestedAt, requestedBy }` (`ChangeInProgressError` while a change is BUILDING/PAUSED/READY — Ruling E6), `CLEAR_REQUEST`, `START_LAUNCH { number, changeId, at }`, `SET_LAUNCH_LINE { number, kind, status, detail }`, `COMPLETE_LAUNCH { number, gitTag, sha, packages, deploymentId, title, summary, changedFiles, launchedBy, trigger, at }` (previous LIVE → PREVIOUS, change → LAUNCHED), `FAIL_LAUNCH { number, reason, at }` (change back to READY, live untouched), `SET_LIVE_VERSION { number, at }` (rollback; versions never removed), `SET_HEALTH { health, at }`, `SET_LAUNCH_PERMISSION { state }`.

- [ ] **Step 1–4:** Reducer tests incl. `slug cannot change after first launch`, `failed launch keeps the live version`, `rollback marks the target LIVE and keeps every version`, every error via operation index → FAIL → implement → PASS, ≥ 95%.
- [ ] **Step 5:** Commit `feat(studio): studio-product launch and versions state`.

### Task 2.5: Launch building blocks in the agent (snapshot, publish, deploy, verify)

**Files:**
- Create: `vetra-cli/src/launch/git-versions.ts`, `launch/publish-all.ts`, `launch/cloud-launch.ts`, `launch/verify.ts`
- Test: `vetra-cli/tests/launch/git-versions.test.ts`, `publish-all.test.ts`, `cloud-launch.test.ts`, `verify.test.ts`

**Interfaces:**
- Produces: `snapshot(workdir, n): Promise<{ sha, tag: 'v<n>' }>` (commit working tree on `main` "Version n: <title>", tag `v<n>`; idempotent if tag exists at HEAD); `restoreVersion(workdir, m): Promise<{ sha }>` (Ruling E5: new commit on `main` whose tree equals `v<m>`, message `Go back to Version m`; no history rewrite); `discardDraft(workdir): Promise<void>` (reset tracked files to HEAD, remove untracked non-ignored files inside reactor project dirs only); `changedFiles(workdir, fromTag, toSha): string[]`; `publishAll(ctx, workdir): Promise<{ name, version }[]` (every reactor project; version via `nextPublishVersion` — Ruling E4; uses `publishReactorProject`); `cloudLaunch(ctx, input)`, `cloudRollback(ctx, deploymentId)`, `ensureProduct(ctx, name)` (GraphQL with Renown bearer + `x-vetra-studio-secret` from `VETRA_STUDIO_LAUNCH_SECRET`); `waitForDeployment(ctx, id, { timeoutMs: 15 * 60_000 }): Promise<'READY' | { failed: string }>`; `checkLive(url): Promise<boolean>` (HTTP 200 on the live URL within 3 tries, 10 s apart).

- [ ] **Step 1–4:** Tests (real git in a temp dir; fake GraphQL/registry) `snapshot tags v1 and is idempotent`, `restoreVersion makes main's tree equal v1 and keeps v2 reachable`, `discardDraft keeps the workspace specs and chats`, `publishAll publishes every project at a fresh version`, `cloudLaunch sends the studio secret header and never logs it` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): version snapshots, publishing and cloud launch calls`.

### Task 2.6: Product drive created and seeded at first launch (D21, default Q3)

**Files:**
- Create: `vetra-cli/src/launch/product-drive.ts`, `vetra-cli/src/launch/seed.ts`
- Modify: `vetra-cli/prompts/agent-profiles/workflow.md` (Tests step: write the starter set as `seed/*.json` per document type, titles prefixed `Example — delete me`), `vetra-cli/src/lifecycle/check-recorder.ts` (seed files validated against the models → part of SMOKE)
- Test: `vetra-cli/tests/launch/product-drive.test.ts`

**Interfaces:**
- Produces: `ensureProductDrive(ctx, { switchboardUrl, name, appEditorId? }): Promise<string>` — on the live switchboard, as the owner's delegated identity: create the drive named after the product (app view as preferred editor when the product has one), add the seed documents once, store id (`SET_PRODUCT_DRIVE`, plus `launchStudioVersion.productDriveId`); later launches/rollbacks never call it again. Access default `SIGNED_IN` (Q3): drive unprotected so any signed-in Renown user can open and write, anonymous read-only where the live switchboard allows it; `setAccess(ctx, 'OWNER_ONLY'|'SIGNED_IN')` toggles drive protection (`setDocumentProtection`) — signed by the owner in the browser if the delegation can't (Step 1 decides).

- [ ] **Step 1:** On a staging production env (Task 2.2): verify with the agent's delegated bearer that (a) drive creation is accepted, (b) a second throwaway Renown identity can open and write an unprotected drive, (c) `setDocumentProtection` by the delegated identity is accepted. (d) find the Connect setting the gitops processor renders for a default drive (`processors/vetra-cloud-environment/gitops.ts`, Connect image env such as `PH_CONNECT_DEFAULT_DRIVES_URL`); if Connect has none, `liveUrl` becomes `https://<slug>.vetra.io/d/<drive-slug>` instead. Record results in the ledger; if (c) fails, `setAccess` becomes a browser-signed action in Task 2.9.
- [ ] **Step 2–5:** Tests `creates the drive once and never again`, `seeds example documents marked Example — delete me`, `invalid seed fails SMOKE with the document name` → FAIL → implement → PASS.
- [ ] **Step 6:** Commit `feat(agent): the live product opens on its own drive with example data`.

### Task 2.7: Launch orchestrator and automatic first launch (D3, D8, default Q2)

**Files:**
- Create: `vetra-cli/src/launch/orchestrator.ts`, `vetra-cli/src/triggers/product-requests.ts`
- Modify: `vetra-cli/src/cli.ts` (trigger), `vetra-cli/src/commands/product/progress.ts` (`done PLAN` calls `ensureProduct` in the background and writes `SET_LIVE_TARGET`; failures logged at error, retried at the next step change)
- Test: `vetra-cli/tests/launch/orchestrator.test.ts`, `tests/triggers/product-requests.test.ts`

**Interfaces:**
- Consumes: Tasks 2.4, 2.5, 2.6 (`ensureProductDrive`).
- Produces: `launch(ctx, { changeId, trigger: 'STUDIO_LAUNCH' }): Promise<void>` — lines in order: SNAPSHOT `Saving version <n>`, PUBLISH `Publishing your product`, DEPLOY `Starting your live app at <slug>.vetra.io`, VERIFY `Checking it's up`, MIRROR (SKIPPED until M4); then `COMPLETE_LAUNCH`, first launch also `ensureProductDrive`; on any failure `FAIL_LAUNCH` with `Couldn't go live: <plain reason>. Your live app is still on Version <m>.` (or "isn't live yet" for the first). Trigger: first build's change becomes READY → `launch` automatically (D3); `pendingRequest LAUNCH` → `launch`; runs server-side with no browser. Launch never needs the LLM; the suggestions step (Task 3.4) is skipped when the budget is used up.

- [ ] **Step 1: Write failing tests** — `auto-launch waits for a passing TESTS gate in the same change`; `seed documents that fail validation block the first launch` (TESTS gate fails via the seed check in Task 2.6); `a failed deploy leaves liveVersion unchanged and records the reason`; `launch runs with no browser connected` (no UI involved; trigger only); `budget exhausted during launch: version goes live, suggestions skipped`; `App and environment are requested when the plan is done`.
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `feat(agent): the first version goes live by itself`.

### Task 2.8: Publishing permission at sign-in (D7)

**Files:**
- Create: `vetra-app/editors/vetra-studio/permission/PublishPermissionModal.tsx`, `permission/usePublishPermission.ts`
- Modify: `vetra-app/editors/vetra-studio/AgentAuthButton.tsx` (removed from the top bar; logic reused), `hooks/useAgentAuth.ts`, `vetra-cli/src/launch/orchestrator.ts` (missing/expired delegation → `SET_LAUNCH_PERMISSION MISSING|EXPIRED`, Live `! needs you`, launch waits and resumes when granted)
- Test: `permission/PublishPermissionModal.test.tsx`, `vetra-cli/tests/launch/permission.test.ts`

**Interfaces:**
- Produces: one modal right after sign-in, title `Let your Studio build and publish for you`, one Renown confirmation (existing agent authorization); decline → build continues; Live shows `! needs you` with `Your Studio needs your OK to publish.` and **Allow**; expiry renews the same way.

- [ ] **Step 1–4:** Tests `asks once after sign-in and not again after accepting`, `declining does not block the build`, `launch waits for permission and resumes when granted` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): one OK to publish, asked at sign-in`.

### Task 2.9: Product view (state 2), launch lines and launch failures (default Q1, default Q3)

**Files:**
- Create: `vetra-app/editors/vetra-studio/live/ProductView.tsx`, `live/LiveEmbed.tsx`, `live/useEmbedFallback.ts`, `live/LiveBanner.tsx`, `live/liveCopy.ts`
- Modify: `strip/stripModel.ts` (live mode), `settings/SettingsDialog.tsx` (name, live address read-only, access switch, budget, Advanced = old `DeploySection` / environments), `failures/failureStates.ts` (launch rows)
- Test: `live/ProductView.test.tsx`, `live/useEmbedFallback.test.ts`, `failures/failureStates.test.tsx`

**Interfaces:**
- Produces: live strip `✓ Plan ✓ Data ✓ Editors ✓ Tests ● Live · <slug>.vetra.io ↗` + `Deployed <n> min ago · <github status>`; embed of the live Connect opened on the product drive (app view if present) with `Open in new tab ↗`; fallback when the frame doesn't load within 10 s or reports a frame/auth refusal → preview labelled `Preview of Version <n> — open the live app ↗` (D12); banner once: `Your product is live.` · `Copy link` · `Anyone with the link can sign in and use it.` · `Change who can use it` (default Q3); returning later: `Went live <n> min ago`; GitHub not connected line: `Code saved in your Studio · Connect GitHub` (default Q1; button arrives in M4 — until then the line has no button); failure rows: launch failed (`Couldn't go live: …` · Try again · Ask the agent to fix it — the latter starts a change with the launch logs attached), live unhealthy (`Your live app isn't responding. We've been notified.` · Restart (= `rollbackStudioVersion` of the live deployment) · Go back to Version N-1 once M3 ships), permission missing.

- [ ] **Step 1–4:** Tests `transition to the live view with the banner after the first launch`, `embed falls back to the version preview when framing is refused`, `launch failure says the live app is still on the previous version`, `no main-path text contains a forbidden plumbing word` (scans rendered strings for the Global Constraints list) → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): the live product fills the page`.

### Task 2.10: Live health

**Files:**
- Create: `vetra-cli/src/triggers/live-health.ts`
- Modify: `vetra-cli/src/cli.ts`; on load the Studio reconciles the product document with the cloud (`studioProduct` + latest deployment) — cloud wins (spec §6.2)
- Test: `vetra-cli/tests/triggers/live-health.test.ts`

**Interfaces:**
- Produces: every 60 s while the Studio runs: `checkLive(liveUrl)`; 3 failures → `SET_HEALTH UNHEALTHY` (logged at error); recovery → HEALTHY; reconcile: a READY deployment newer than `liveVersion` (launch finished while the Studio was down) → `COMPLETE_LAUNCH` / `SET_LIVE_VERSION` from the cloud record.

- [ ] **Step 1–4:** Tests `three failed checks mark the live app unhealthy`, `cloud READY deployment reconciles a stale document` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): notice when the live app stops answering`.

### Task 2.11: M2 harness phases, release and acceptance (default Q3)

**Files (harness):** Create `phases/golive-phase.mjs` (after build: no clicks; waits for strip `● Live`, records each launch line time, opens the live URL in a fresh context as a *second* throwaway identity at phone viewport 390×844, signs in, creates a document in the product drive; asserts GitHub not connected; G2 timing from Build to live 200), Modify `run.mjs` (`all` = login,build,golive).

- [ ] **Step 1:** Implement; commit.
- [ ] **Step 2:** RR-cloud (Tasks 2.1–2.3), run `rotateStudioLaunchSecret` for the existing staging Studios (rapid-fox, safe-robin, harness Studio) — verify each pod restarted once and still Ready; RR-studio (Tasks 2.4–2.10).
- [ ] **Step 3:** Acceptance: fresh Studio, `node run.mjs --phase all` → live URL working ≤ 15 min from Build with zero clicks after Build except sign-in/permission (G2, G5); second identity can use it on a phone viewport (Q3); closed-tab variant: close the page right after Tests ✓, reopen after 10 min → state 2 with `Went live … ago`.

---

## M3 — Change safely

### Task 3.1: Change lifecycle — one change at a time, its own conversation (D13, D17)

**Files:**
- Create: `vetra-cli/src/product/changes.ts`
- Modify: `vetra-cli/src/triggers/product-requests.ts` (DISCARD request → `discardDraft` + `DISCARD_CHANGE`), product doc model (module `change` gains `DISCARD_CHANGE { changeId, at }` — status DISCARDED, kept in history), `vetra-cli/prompts/agent-profiles/workflow.md` (a change: plan only the affected steps; a request during a building change is added to it with `I'll include that in this change`)
- Test: `vetra-cli/tests/product/changes.test.ts`, model `v1/tests/change.test.ts`

**Interfaces:**
- Produces: `startChange(ctx, { request, kind: 'CHANGE' | 'UNDO' }): Promise<{ changeId, sessionId }>` (new chat session per change; base = live version's code); `Keep changing` = a new message in the same change's session; discard resets the preview to the live code and keeps the change marked DISCARDED.

- [ ] **Step 1–4:** Tests `a change gets its own conversation`, `discard resets the code to the live version and keeps the story`, `a second request while building joins the change` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): changes after launch are separate, discardable units`.

### Task 3.2: Data-compatibility gate at launch (D6)

**Files:**
- Create: `vetra-cli/src/launch/compat-launch.ts`
- Modify: `vetra-cli/src/launch/orchestrator.ts` (gate before SNAPSHOT for N ≥ 2)
- Test: `vetra-cli/tests/launch/compat-launch.test.ts`

**Interfaces:**
- Produces: `compareModels(live: ModelSpec[], next: ModelSpec[]): { breaking: { model, what }[] }` (Ruling E9: `graphql` `findBreakingChanges` on each model's state + operation input schemas, plus any new non-null field on an existing state type, removed/renamed operations, removed models; additive = new nullable fields, new operations, new models); a blocked launch writes `FAIL_LAUNCH` with `This change would break data your users already have: <what>.` and messages the agent `Make this change additive: keep existing fields and operations, add new ones as optional.` (or the Powerhouse model-versioning path if the 6.2.3 train supports it for this model — Step 1 checks).

- [ ] **Step 1:** Check whether the Studio's Powerhouse train supports document-model version upgrades for customer models (`upgrades/` manifests + reducer upgrade path); record yes/no in the ledger; the agent message names that path only if yes.
- [ ] **Step 2–5:** Tests `new optional field launches`, `new operation launches`, `removed field blocks with a plain reason`, `new required field blocks`, `changed field type blocks` → FAIL → implement → PASS.
- [ ] **Step 6:** Commit `feat(agent): launches that would break existing data are stopped`.

### Task 3.3: Go back — compatibility at rollback, orchestration, Undo with the agent

**Files:**
- Create: `vetra-cli/src/launch/compat-rollback.ts`, `vetra-cli/src/launch/rollback.ts`
- Modify: `vetra-cli/src/triggers/product-requests.ts` (ROLLBACK request), product doc (`SET_ROLLBACK_BLOCK { number, reason: String }` on Version: `rollbackBlockedReason: String`)
- Test: `vetra-cli/tests/launch/compat-rollback.test.ts`, `tests/launch/rollback.test.ts`

**Interfaces:**
- Produces: `usedInDrive(ctx, switchboardUrl, driveId): Promise<{ documentTypes: Set<string>; operationTypes: Map<string, Set<string>> }>` (one bounded read of the drive's documents and their operation types on the live switchboard); `canGoBack(target: ModelSpec[], used): { ok: true } | { ok: false; reason }`; `goBack(ctx, m)`: compat check → `rollbackStudioVersion(<deploymentId of m>)` → wait READY → `restoreVersion(workdir, m)` → `SET_LIVE_VERSION m`; refused → `SET_ROLLBACK_BLOCK m` with `Can't go back automatically: Version <k> added data your users have already used. Ask the agent to undo the change instead.`; **Undo with the agent** = `startChange({ kind: 'UNDO', request: "Undo '<title>' but keep existing data" })`.

- [ ] **Step 1: Write failing tests** — `rollback dispatches nothing to the product drive` (fake switchboard records zero writes); `rollback refused when the drive uses an operation added after the target`; `rollback allowed when only fields were added after the target`; `after go back the next change starts from the target's code`; `versions after the target stay listed and can be launched again`.
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `feat(agent): go back to any version your data can live with`.

### Task 3.4: Agent suggestions (G8)

**Files:**
- Modify: product doc (module `suggestions`: state `suggestions: [Suggestion!]!` `{ id: OID!, text: String!, afterVersion: Int!, status: SuggestionStatus! (OPEN USED DISMISSED) }`; ops `SET_SUGGESTIONS { afterVersion, items: [{ id, text }] }`, `USE_SUGGESTION { id }`, `DISMISS_SUGGESTION { id }`), `vetra-cli/src/commands/product/progress.ts` (`suggest`: 2–3 items, each ≤ 80 chars; rejects text matching a DISCARDED change's request), `vetra-cli/src/launch/orchestrator.ts` (after COMPLETE_LAUNCH, a short final agent turn asks for `suggest` unless the budget is used up)
- Test: model `v1/tests/suggestions.test.ts`, `vetra-cli/tests/product/suggest.test.ts`

- [ ] **Step 1–4:** Tests `suggest keeps 2–3 items`, `a discarded idea is not suggested again`, `using a suggestion marks it used` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): suggest the next improvement after each launch`.

### Task 3.5: Change drawer, Live | Preview split, Ready bar

**Files:**
- Create: `vetra-app/editors/vetra-studio/change/ChangeDrawer.tsx`, `change/SplitView.tsx`, `change/ReadyBar.tsx`, `change/changeCopy.ts`
- Modify: `live/ProductView.tsx` (bubble `Change something`), `strip/stripModel.ts` (`● Live · v<n>   ◐ Change: Data 1/1 · Editors · Tests`)
- Test: `change/ChangeDrawer.test.tsx`, `change/ReadyBar.test.tsx`

**Interfaces:**
- Produces: drawer input `What should change?` with suggestion chips (editable before sending), past changes grouped by version (`Version 3 — Added a Ready column`); split labels `Live — what your users see now` | `Preview — your change, not live yet`; Ready bar `Ready to go live.` `<title>` · `checks passed` · **Make it live** (dispatches `REQUEST_LAUNCH`) · **Keep changing** · **Discard** (confirm `Throw away this change? Your live app isn't affected.` → `pendingRequest DISCARD`); after launch `Version <n> is live.` and the split closes.

- [ ] **Step 1–4:** Tests `split shows the live app unchanged while the change builds`, `Make it live writes a launch request`, `Discard asks first and keeps the story`, `suggestion chip text is editable before sending` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): change the live product safely`.

### Task 3.6: Versions panel

**Files:**
- Create: `vetra-app/editors/vetra-studio/versions/VersionsPanel.tsx`, `versions/versionRows.ts`
- Test: `versions/versionRows.test.ts`, `versions/VersionsPanel.test.tsx`

**Interfaces:**
- Produces: `versionRows(doc, now)` → rows `{ number, title, when, who ('you' | 'built by Vetra'), live: boolean, action: 'go-back' | 'undo-with-agent' | 'none', blockedReason?, whatChanged: { summary, files, commitUrl? } }`; Go back confirm text `Make Version <m> live again? Your users' documents stay as they are. Changes made after Version <m> aren't deleted — you can come back to Version <n> any time.`; Go back disabled with `Finish or discard your change first.` while a change is open (Ruling E6); a blocked row shows the reason and **Undo with the agent**. Opened from `Version <n> ▾` in the live strip; the unhealthy banner's **Go back to Version N-1** (Task 2.9) uses the same confirm and checks.

- [ ] **Step 1–4:** Tests `every launch is listed, newest first, live marked`, `go back confirmation text`, `blocked row offers Undo with the agent`, `go back disabled during a change` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): versions you can go back to`.

### Task 3.7: Existing Studios open in the new experience (G11; moved before prod — default Q4)

**Files:**
- Create: `vetra-cli/src/product/upgrade-existing.ts`
- Modify: `vetra-cli/src/cli.ts` (run once at startup when the drive has reactor projects or chat sessions and no product document)
- Test: `vetra-cli/tests/product/upgrade-existing.test.ts`

**Interfaces:**
- Produces: `adoptExisting(ctx): Promise<'created' | 'skipped'>` — product document with name from the drive name, one `BEFORE_VERSIONS` change whose chat sessions are the old ones, steps ✓ for existing models/editors/app, Tests ○; Live from the cloud: an env (not the Studio's own) with the workspace packages installed → shown as `Live (set up before versions)`; the next launch becomes Version 1 through `ensureStudioProduct` (new App + env at the product slug) and the old env is left untouched and listed in Settings › Advanced (Ruling E10: no adoption of the old env; never deleted). All reactor projects ship together. Only *adds* the product document and git (initialises the repo when absent, no tags until the first launch).

- [ ] **Step 1–4:** Tests `old Studio with two projects gets one product with both`, `old chats become the Before versions chapter`, `a previously deployed env shows as live before versions and is never modified`, `second start does nothing` → FAIL → implement → PASS.
- [ ] **Step 5:** Upgrade test on copies: export `rapid-fox` (staging) and `vivid-slug` (prod) workspaces with the Foundation workspace export (`/preview/workspace-export`, operator only), import each into a fresh staging Studio on the M3 build, open the page → specs, models, editors, chats present; environments and GitHub connection shown in Settings › Advanced; nothing deleted. Record in ledger.
- [ ] **Step 6:** Commit `feat(studio): existing Studios open with their work as the first chapter`.

### Task 3.8: M3 harness phases, release, acceptance

**Files (harness):** Create `phases/change-phase.mjs` (G6: click a suggestion or type `Add a notes field to each task`; assert split labels; live URL (second context) still shows old version while the preview shows the field; Ready bar → Make it live ≤ 3 min; live shows the field), `phases/versions-phase.mjs` (G7 script exactly as the spec: v1 → docs → v2 adds a field → docs → Go back to v1 (all docs readable) → forward to v2 → v3 adds an operation, used in the drive → Go back to v2 refused with `Undo with the agent`, nothing changed; G8 suggestions present after each launch), `phases/upgrade-phase.mjs` (opens a given old Studio, asserts the Before-versions chapter).

- [ ] **Step 1:** Implement; commit.
- [ ] **Step 2:** RR-cloud if cloud changed; RR-studio.
- [ ] **Step 3:** Acceptance: `node run.mjs --phase all,change,versions` green on a fresh Studio; `upgrade` on the two imported copies green. Record timings (G6/G7 medians from 3 runs).

### Task 3.9: Prod rollout after M3 (default Q4)

- [ ] **Step 1:** Report the M3 staging results to Frank before starting (Foundation practice).
- [ ] **Step 2:** k8s `tenants/vetra/powerhouse-values.yaml:96,305` switchboard/connect `v6.2.3-dev.28` → the Studio's version (forward only); migrations applied; health as Task 0.1 Step 3.
- [ ] **Step 3:** RR-cloud to prod: merge `staging` → `main` (version field from `main`), release, prod `PH_REGISTRY_PACKAGES` → the stable version; prod budget default stays `"1"`; `rotateStudioLaunchSecret` for existing prod Studios.
- [ ] **Step 4:** Prod `STUDIO_POOL_VERSION` → the M3 Studio version; three warm Studios Ready, 0 restarts.
- [ ] **Step 5:** Demo Studio per the ledger decision (Frank 2026-10-20): fresh prod Studio owned by the Vetra ops Renown identity (key only in OpenBao `kv/powerhouse/shared/`), Frank as operator, `setStudioLlmBudget(…, 50)`.
- [ ] **Step 6:** Investor script on prod with the harness (`VETRA_APP_URL=https://vetra.io`, `--phase all,change,versions`): idea → live → change → launch → go back, data intact. vetra.io `main` == `staging`.

---

## M4 — GitHub without thinking

### Task 4.1: One GitHub connection — repos for Studio products, personal and org

**Files (cloud):**
- Modify: `subgraphs/vetra-apps/service.ts:801-1080` (extract repo creation from `createStudioAppLocked` into `attachStudioRepository`; no workflow file is committed for Studio products — D15), `github.ts:513-517` (org path reused), `errors.ts`, `schema.ts`, `resolvers.ts`, `db/migrations.ts` (`app_deployments.mirror_sha text null`)
- Test: `subgraphs/vetra-apps/__tests__/studio-repo.test.ts`

**Interfaces:**
- Produces: `attachStudioRepository(input: { appId: ID!, installationId: String!, name: String }): App!` (owner in person; private repo named after the slug, taken → suffix, description `<name> — built with Vetra Studio`; personal or org per the installation account) and `studioPushToken(appId: ID!): StudioPushToken!` `{ token, expiresAt, remoteUrl }` (Studio agent path, Task 2.1 binding; installation token limited to that repo, ≤ 1 h). Org refusals map to the Foundation codes with plain next steps: `ORG_POLICY` → `Ask an owner of <org> to allow Vetra, or choose your personal account`; `INSUFFICIENT_PERMISSION` (app not installed on the org / caller not a member) → `Install Vetra on <org> or choose your personal account`; `REPO_EXISTS` handled by suffixing.

- [ ] **Step 1: Write failing tests** — `personal installation creates a private repo in the user account`; `org installation posts to /orgs/<login>/repos`; `org repo creation restricted to owners maps to ORG_POLICY with the ask-an-owner message`; `app not installed on the org maps to INSUFFICIENT_PERMISSION`; `caller no longer an org member is refused`; `push token is scoped to the App's repo and never returned to another Studio`.
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `feat(apps): Studio products keep a copy of their code on GitHub, personal or org`.

### Task 4.2: GitHub pushes detected (D15)

**Files (cloud):**
- Modify: `subgraphs/vetra-apps/webhook.ts:77-160` (new `push` handler: production branch only; shas equal to a recorded `mirror_sha` ignored; others set `apps.external_changes_sha`), `db/migrations.ts` (`apps.external_changes_sha text null`), `schema.ts` (`App.externalChangesSha`), mutations `recordStudioMirror(appId: ID!, sha: String!): Boolean!` (agent path; stores `mirror_sha` on the App's latest PRODUCTION deployment) and `clearExternalChanges(appId: ID!): Boolean!` (agent path)
- Test: `subgraphs/vetra-apps/__tests__/webhook-push.test.ts`

- [ ] **Step 1–4:** Tests `own mirror push is ignored`, `push to main by someone else is flagged`, `push to another branch is ignored` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(apps): notice code pushed to GitHub outside the Studio`.

### Task 4.3: Existing Studio GitHub connections carried over; old repo creation retired

**Files (cloud):**
- Modify: `subgraphs/vetra-github-auth/resolvers.ts` (repo creation returns `GITHUB_MOVED` with `Connect GitHub from your product's settings`), `subgraphs/vetra-apps/service.ts` (`adoptStudioRepository(appId)` — when the Studio has a `vetra-github-auth` repo and the Deploy app is installed on that account, record that repo on the App without creating a new one)
- Modify: `vetra-cli/src/helpers/github.ts` (push token from `studioPushToken` when the App has a repo; fall back to the `vetra-github-auth` token for Studios not yet moved — no customer action needed)
- Test: `subgraphs/vetra-apps/__tests__/studio-repo-adopt.test.ts`, `vetra-cli/tests/helpers/github-token.test.ts`

- [ ] **Step 1–4:** Tests `existing connection keeps pushing until moved`, `adopting keeps the existing repo`, `old repo creation answers with the new path` → FAIL → implement → PASS.
- [ ] **Step 5:** Commits `feat(apps): carry existing Studio repositories over` (cloud) and `feat(agent): push with the product's GitHub connection` (vetra-cli).

### Task 4.4: Mirror on launch, history on connect, bring in GitHub changes

**Files:**
- Create: `vetra-cli/src/launch/mirror.ts`
- Modify: `vetra-cli/src/launch/orchestrator.ts` (MIRROR line; failure → `Couldn't save to GitHub (<reason>). Will retry with the next launch.` + Retry now; never fails the launch), product doc module `github` (`github: GithubLink!` `{ status: GithubStatus! (NOT_CONNECTED CONNECTED DISCONNECTED PUSH_FAILED), repoFullName: String, lastError: String, externalChangesSha: String }`; ops `SET_GITHUB { status, repoFullName, lastError }`, `SET_EXTERNAL_CHANGES { sha }`), `vetra-cli/src/product/changes.ts` (**Bring them in** = `startChange` that fetches `main` from GitHub and asks the agent to merge into the change; never launched automatically)
- Test: `vetra-cli/tests/launch/mirror.test.ts`, model `v1/tests/github.test.ts`

**Interfaces:**
- Produces: `mirror(ctx, { tags: string[] }): Promise<{ sha } | { failed: string }>` (push `main` + all `v*` tags with a token from `studioPushToken`; then `recordStudioMirror(appId, sha)` so the webhook ignores our own push); `pushFullHistory(ctx)` on connect.

- [ ] **Step 1–4:** Tests `launch succeeds when the mirror push fails`, `connect pushes every version tag`, `bring in creates a change and launches nothing` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(agent): every launch is a commit and tag on GitHub`.

### Task 4.5: Connect GitHub in the Studio (after the first launch; default Q1)

**Files:**
- Create: `vetra-app/editors/vetra-studio/github/GithubStatusLine.tsx`, `github/ConnectGithubDialog.tsx`, `github/githubClient.ts`
- Modify: `settings/SettingsDialog.tsx` (GitHub section), `live/ProductView.tsx`; remove the device-flow `deploy/GithubConnectCard.tsx` from the main path (kept under Advanced for developer Apps)
- Test: `github/ConnectGithubDialog.test.tsx`, `github/GithubStatusLine.test.tsx`

**Interfaces:**
- Produces: never shown before the first launch; status line variants `Code saved in your Studio · Connect GitHub`, `GitHub ✓`, `GitHub disconnected — your code is still saved in the Studio.` (Reconnect), `There are changes on GitHub that aren't in your Studio` (Bring them in); connect = open `githubDeployAppInfo.installUrl` in a popup (vetra.io's callback page runs `connectGithubDeploy`), poll `myGithubDeployInstallations`, pick account or org, `attachStudioRepository`; Live step detail sentence `Keep a copy of your code in your own GitHub account. Every launch becomes a commit you can see.`

- [ ] **Step 1–4:** Tests `no GitHub prompt before the first launch`, `account and org choices come from installations`, `org policy refusal shows the ask-an-owner message` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(studio): connect GitHub once, personal or organisation`.

### Task 4.6: vetra.io Studio card shows the product

**Files (vetra.io):**
- Modify: `modules/cloud/studio/components/studio-product-card.tsx`, `modules/cloud/studio/use-studio-products.ts` (query `studioProduct(studioEnvironmentId)`), new client fn in `modules/apps/graphql.ts`
- Test: `modules/cloud/studio/components/__tests__/studio-product-card.test.tsx`

- [ ] **Step 1–4:** Tests `card shows product name, live link and Live status`, `card without a live product shows Building` → FAIL → implement → PASS (`pnpm test:unit`, `pnpm -s tsc`, lint 0 errors).
- [ ] **Step 5:** Commit `feat(studio): the Studio card shows your live product`; RR-web.

### Task 4.7: M4 harness, release, acceptance (prod follows — default Q4)

**Files (harness):** Modify `phases/github-phase.mjs` (new flow: after live, Connect GitHub → install/authorise → pick `froid1911` → repo with tags `v1…vN`; second Studio picks `web3-berlin` → org repo with tags; push a commit to `main` with the GitHub API as froid1911 → `There are changes on GitHub…` appears → Bring them in starts a change; launch → tag pushed).

- [ ] **Step 1:** Implement; commit.
- [ ] **Step 2:** RR-cloud, RR-studio.
- [ ] **Step 3:** Acceptance (G9): `GH_LOGIN=… GH_PASSWORD=… node run.mjs --phase github --headed` → personal and org repos with version tags; no second GitHub app asked for.
- [ ] **Step 4:** Prod follow-up: Task 3.9 Steps 3–4 for the M4 versions; vetra.io `main` == `staging`.

---

## M5 — Demo hardening

### Task 5.1: Landing copy restored where now true

**Files (vetra.io):** `modules/landing/studio/studio-control.tsx`, `studio-flow.tsx`, `studio-hero.tsx`, `studio-session-window.tsx`; Test: `modules/landing/__tests__/studio-page.test.tsx`

**Interfaces:**
- Copy (exact): Foundation's "Your work is saved" card → title `Every launch is a version you can go back to`, body `Each launch is saved as a version; go back with one click, your users' documents stay.`; the Foundation line `Major version upgrades may need a re-run; keep an export of important work` stays.

- [ ] **Step 1–4:** Tests assert the new strings and the absence of `Data may be lost between versions` → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `docs(studio): say what versions do now`; RR-web.

### Task 5.2: Five green staging runs and the numbers

- [ ] **Step 1:** Run `node run.mjs --phase all,change,versions` 5× on fresh Studios with both standard prompts (`create todo app product`, `An office suite: docs, sheets, slides`); medians: first preview ≤ 6 min, live ≤ 15 min (G2), Make it live ≤ 3 min (G6), Go back ≤ 3 min (G7), steps ≤ 60 and cost ≤ $0.20 per first build (G10). Record per-run numbers in the ledger.
- [ ] **Step 2:** Every failure: root cause first (superpowers:systematic-debugging), fix in the owning task's files with a failing test, re-release, re-run until 5 consecutive greens.
- [ ] **Step 3:** Update `strip/phase-averages.json` from the 5 runs (Task 1.7); RR-studio.

### Task 5.3: Prod rollout of M4/M5 and the investor script

- [ ] **Step 1:** Prod pins as Task 3.9 Steps 3–4 for the final versions; demo Studio on the final Studio version (owner-signed `SET_SERVICE_CONFIG` per memory `vetra-env-doc-admin-edits`).
- [ ] **Step 2:** Investor script on prod via the harness: idea → live on a phone → change → Make it live → Go back, data intact; GitHub org connect on the demo Studio. Report to Frank.

---

## Rulings made while planning (spec gaps)

- **E1** The staging harness stays outside the public repos (it automates logins); it becomes a local git repo in its scratch directory (Task 0.2).
- **E2** The cloud branch starts from `feat/foundation` (`922e44c`): Foundation's cloud work is on staging but not yet on `main`, and the Experience depends on it; RR-cloud merges into staging as Foundation did.
- **E3** D20's "Studio binding" is proved by a per-Studio random launch secret written by the warm-pool claim (same batched write as `VETRA_SESSION_EXPORT_SECRET`), checked by hash, together with the owner's current Renown delegation to the agent's did:key (Task 2.1).
- **E4** Package version per launch = `nextPublishVersion` (patch past the highest published); the customer only sees "Version N"; the package versions are recorded per version.
- **E5** Go back = a new commit on `main` whose tree equals tag `v<m>` (no history rewrite, mirror stays fast-forward); tags `v<n>` are set only by launches.
- **E6** Go back is disabled while a change is open ("Finish or discard your change first.") — one writer to the code at a time (D13).
- **E7** The browser asks for launch/rollback/discard by writing request operations into the product document; the agent's trigger performs them, so a closed tab never stops them.
- **E8** "Preview renders without errors" (D11) is a server-side check (package builds; every editor/app module serves without a transform error; seed documents validate), so automatic launch works with the browser closed.
- **E9** Breaking change = `graphql` `findBreakingChanges` on state + operation input schemas, plus any new non-null field on an existing state type, removed operations or removed models.
- **E10** Existing Studios with a pre-versions deployment keep that environment untouched (shown in Advanced); their first launch creates the product App at the product slug instead of adopting the old env.
- **E11** Under Q4's default (prod after M3) the existing-Studio upgrade (G11) moves from M5 into M3 (Task 3.7), because prod rollout needs it.
