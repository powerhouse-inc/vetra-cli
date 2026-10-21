# Vetra Studio Iterate & Design (Project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vetra product can be shaped by hand on top of what exists — a calm layered story, arrangeable layout modes, point-and-change in the preview, a theme of its own, remix/compose of published packages, two variants side by side, an agent self-review after every version and notes from the live product — all ending in the investor demo script green on a fresh staging Studio.

**Architecture:** Everything the browser shows still renders from the `vetra/studio-product` document (extended additively in Task 0.3) plus the chat session; everything that changes code or git runs in the Studio agent process (vetra-cli), reached from the browser through new owner-gated preview-server routes in one new route module (`preview-server/iterate-routes.ts`), so the other Studio controller's `server.ts` changes stay mergeable. Studio-made edits (text in place, theme "Keep", "Keep A/B", remix import) share one server-side path (`product/studio-edit.ts`) that joins or starts a change, commits, runs the standard checks and records milestones — so every hand edit is an ordinary change → version → Go back. Frame-touching features (Point, theme live preview, review probes) work only on the same-origin preview frame.

**Tech Stack:** TypeScript; React 19 + Tailwind v4 Connect editors (vitest 4, happy-dom) in `vetra-app`; vetra-cli on ph-clint + Mastra (jest ESM) in `vetra-cli`; Powerhouse document models via `ph-cli generate`; GitHub Actions release workflow; Playwright staging harness (node ESM).

**Spec:** `docs/superpowers/specs/2026-10-21-iterate-design-design.md` (this repo, branch `spec/iterate-design`, commit `096f3ba`). Builds on `docs/superpowers/specs/2026-10-20-studio-experience-design.md` and its plan `docs/superpowers/plans/2026-10-20-studio-experience.md` (Projects 2+3, running in parallel on `feat/studio-experience` under another controller).

**Open-question default (spec §8):** Q2 — any signed-in visitor of the live product may send a note, capped per sender per day (Task 8.1/8.3).

## Workspaces

| Repo | Worktree | Branch | Base |
|---|---|---|---|
| vetra-cli (Studio: `vetra-cli` + `vetra-app`) | `/home/f/projects/vetra-cli-exp-p4` | `feat/iterate-design` | `spec/iterate-design` (`096f3ba`, on `feat/studio-experience` `ace5b4c`) |
| per task | `/home/f/projects/vetra-cli-exp-p4-<task>` (e.g. `-1.2`) | `p4/<task>` | `feat/iterate-design` HEAD at dispatch; merged back `--no-ff` after review |
| Staging harness (P4 copy) | `/home/f/.claude/jobs/81234be8/tmp/staging-e2e-p4` (Task 0.2: `git clone` of `staging-e2e`) | `p4` | `staging-e2e` `master` `f20de90` |

No vetra-cloud-package or ph-clint change is planned: `launchStudioVersion` accepts any `@vetra-apps/*` package list (`vetra-apps/service.ts:3732`), and repositories stay private (no visibility API — ruling P4-10). The harness original (`staging-e2e`) belongs to the Projects 2+3 controller: never commit there; P4 phases live only in the P4 copy.

## Global Constraints

- **STAGING ONLY.** Nothing in prod. No PRs to `main`. Merging into main/prod is decided later.
- **Coordination:** merge `feat/studio-experience` into `feat/iterate-design` at the start of every milestone (and whenever a task needs something from it); resolve conflicts on our side; after a merge that touched `studio-product.json`, re-run `pnpm --filter vetra-app generate` instead of hand-merging `gen/`.
- **Never** change the staging pool pin (`STUDIO_POOL_VERSION`), never publish with dist-tag `dev` or `latest`, never touch other sessions' branches, Studios or pins. P4 prereleases are `0.0.9-p4.N`, dist-tag `p4`, **registry.vetra.io only** (RR-p4).
- Pin only our own test Studios (created by the P4 harness), owner-signed `SET_SERVICE_CONFIG` + `APPROVE_CHANGES` (v2 signatures).
- Workflow-file pushes go over SSH: `git push git@github.com:powerhouse-inc/vetra-cli.git HEAD:feat/iterate-design`; never `gh auth refresh`.
- **Commits:** conventional; **no `Co-Authored-By` / "Generated with" trailers**. PR bodies (if any) end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The repo is public: neutral wording, no security language.
- Never print secrets; keep command output short; **never bare `git stash`** (WIP commits instead). Scratch under `/home/f/.claude/jobs/81234be8/tmp`.
- Document models follow the repo CLAUDE.md: edit `studio-product.json` (+ `schema.graphql` mirrors via codegen) and run `ph-cli generate` (R2 path, `ph vetra` not running), **never edit `gen/`**, pure reducers (ids/timestamps from input), errors via the model's `errors` list (PascalCase `…Error`), error tests via the operation-index pattern (never `.toThrow()`), reducer coverage ≥ **95%** lines/branches/functions/statements (`pnpm --filter vetra-app test:coverage`).
- **Additive only:** new optional fields/new operations; existing Studios' documents keep loading (new lists get defaults in `v1/src/normalize.ts`).
- New preview-server routes are **owner-only** (`requireOwner`, Studio-bound Renown token) and live in `vetra-cli/src/preview-server/iterate-routes.ts`; `server.ts` gains exactly one dispatch line.
- **Budget:** a new agent pass (self-review, variants) shows its estimated cost before running when the estimate is > **$0.50**; self-review is skipped when the budget level is `low` or `exhausted`.
- **Customer-facing words never used on the main path:** environment, package, registry, Harbor, image, workflow, device code, approve changes, switchboard (Settings › Advanced only). Exception ruled for G5: the browse list may say "Start from an existing product" and show the package's own name.
- Copy is exact where this plan quotes it; tests assert the strings.
- `localStorage` access always in `try/catch`; the page works without it.
- Pure UI logic lives in `.ts` modules with unit tests; components get happy-dom tests next to them (`// @vitest-environment happy-dom`, helpers in `editors/vetra-studio/test-utils/`).

## Release recipe RR-p4 (staging test build)

1. On `feat/iterate-design`: set `version` in `vetra-cli/package.json` and `vetra-app/package.json` to `0.0.9-p4.N` (N = previous + 1, start at 1); commit `chore: 0.0.9-p4.N`; push over SSH.
2. `gh workflow run release.yml -R powerhouse-inc/vetra-cli --ref feat/iterate-design -f prerelease-tag=p4` (input from Task 0.1); watch with `gh run watch --exit-status`; on 409/504/E403 `gh run rerun --failed`.
3. Verify: `curl -sI https://registry.vetra.io/vetra/-/vetra-0.0.9-p4.N.tgz` → 200; `npm view vetra@0.0.9-p4.N --registry https://registry.dev.vetra.io` → not found; `npm view vetra dist-tags --registry https://registry.vetra.io` → `p4: 0.0.9-p4.N`, `dev`/`latest` unchanged.
4. Wait for the image: `kubectl --context k3s -n clint-builds get jobs | grep 0.0.9-p4.N` → Complete (if absent after 15 min, `POST /webhook {"type":"publish","packageName":"vetra","version":"0.0.9-p4.N"}` to the builder service via `kubectl port-forward`).
5. Pin the P4 test Studio(s): `node run.mjs --phase pin --studio <sub>` in the P4 harness (`PIN_VERSION=0.0.9-p4.N`, Task 0.2) → agent pod Running 1/1, `/preview/version` reports `0.0.9-p4.N`.
6. Record N, run id and evidence in the ledger.

## Test commands

The compressed "tests → FAIL → implement → PASS" steps mean: write the named tests, run the command and see them fail for the missing behaviour, implement, run again and see them pass with no new failures (record pre-existing failures before starting).

- vetra-app: `pnpm --filter vetra-app test -- <pattern>`; coverage `pnpm --filter vetra-app test:coverage`; then `pnpm --filter vetra-app typecheck && pnpm --filter vetra-app lint`
- vetra-cli: `pnpm --filter vetra test -- <pattern>`; then `pnpm --filter vetra typecheck && pnpm --filter vetra lint`
- harness: `node --test lib/*.test.mjs`; `node run.mjs --phase <list> [--studio <sub>]` → `summary.json`

## Review Focus

1. **Activity layer hiding an open problem** — a check that is failing *now* (latest run failed, stuck, needs-you, a question) must never be folded into a summary; only failures that later passed in the same milestone fold. Test: Task 1.2 `latest failing run stays its own line while an earlier failure folds`.
2. **Point mode leaking into the product** — after Point is switched off (or the frame reloads / navigates), no outline element, listener or `contenteditable` remains and clicks reach the product's own handlers again. Test: Task 3.1 `detach removes every listener and overlay; product click handler fires again`.
3. **Text edit replacing the wrong string** — the literal search ignores `gen/`, `node_modules/`, tests and non-string code; a literal in two places, inside a longer string, or only in generated code is "not exactly one" and goes to the agent. Test: Task 3.5 `literal also present inside a longer string counts as ambiguous`.
4. **Theme bleeding into the Connect shell** — theme CSS only applies inside the product's editor root; the drive list and toolbar keep their look; dark mode keeps working. Test: Task 4.2 `theme css only targets the scope selector, never :root or html`.
5. **Remix that builds but silently lost parts** — every document model, editor, processor, subgraph and test from the source is either present in the remix or listed as missing in the story and `REMIX.md`. Test: Task 5.3 `missing editor is listed, never dropped silently`.

## Plan rulings (copied into the ledger at execution start)

- P4-1: tool-name → intent table as in Task 1.1, built on `doingNow.ts`'s sets — wrong grouping only changes summary wording.
- P4-2: Activity drops interim agent replies except a question, the newest reply and a reply to a steer — needed for ≤ 12 lines; if customers miss replies, Raw still has them.
- P4-3: all P4 product-document fields land in one additive schema task (0.3) to keep `studio-product.json` conflicts with the parallel controller to one codegen merge — unused fields if a milestone is cut.
- P4-4: P4 routes live in `preview-server/iterate-routes.ts` behind one line in `server.ts` — merge safety.
- P4-5: hand edits (text, theme, keep-variant, remix) run server-side without an agent turn and record their own checks (`applyStudioEdit`), so they are normal changes → versions → Go back.
- P4-6: the Point layer is direct DOM via `contentDocument`, no injected script — same-origin only (live view uses the preview of the live version).
- P4-7: theme scope = Connect's `#document-editor-context[data-editor=…]` + `[data-vetra-app]`; overrides raw design-system variables.
- P4-8: curated fonts as listed in Task 4.1 (Google Fonts).
- P4-9: screenshots via `html-to-image` in the browser (no headless browser exists in the agent pod).
- P4-10: going public = source inside the published product tarball (registry URL) — the cloud creates repositories private and has no visibility API; GitHub-public is later work.
- P4-11: variants are built one after the other in the main workspace on two branches; side by side uses a second preview service instance when ≥ 900 MB free, else a switcher.
- P4-12: the live corner (Send a note, Source) is mounted by the shared `@vetra-apps/product-notes` package's module side effect.
- P4-13: the per-sender daily cap (5) is enforced in the widget and in the Studio inbox (no server-side processor) — a determined sender can exceed it, but the owner never sees the excess.
- P4-14: corner configuration is written into the product package at publish; switching notes on is a relaunch and therefore a new version.
- P4-15: self-review probes (narrow screen, empty state, contrast) run in the Studio browser when it is open after a launch; static checks always run server-side.
- P4-16: cost estimate = 2 × average change cost (spent / launched-or-ready changes, fallback $0.60) for variants; review pass capped at $0.25.
- P4-17: "Show me two ways" is recognised by the Studio, not the agent.
- P4-18: a remix aligns all Powerhouse dependencies to the Studio's single Powerhouse version (R16) so it builds in the Studio.

---

## M0 — Ground

### Task 0.1: P4 prerelease channel in the release workflow

**Files:**
- Modify: `.github/workflows/release.yml`
- Create: `vetra-cli/scripts/publish/release-channel.mjs`, `vetra-cli/tests/scripts/release-channel.test.ts`

**Interfaces:**
- Produces: `resolveReleaseChannel({ branch, prereleaseTag, version }): { distTag: string; registries: string[] }` (throws with a one-line message). Workflow input `prerelease-tag` (string, default `""`).

- [ ] **Step 1: Tests** in `release-channel.test.ts`:
  - `main → dev on both registries` (`{branch:"main", prereleaseTag:"", version:"0.0.8-dev.9"}` → `{distTag:"dev", registries:["https://registry.dev.vetra.io","https://registry.vetra.io"]}`)
  - `production → latest on both registries`
  - `p4 prerelease → p4 on registry.vetra.io only` (`{branch:"feat/iterate-design", prereleaseTag:"p4", version:"0.0.9-p4.1"}` → `{distTag:"p4", registries:["https://registry.vetra.io"]}`)
  - `p4 tag refuses a version without -p4.` (`0.0.9-dev.1` throws `version 0.0.9-dev.1 does not match the p4 channel (expected -p4.N)`)
  - `prerelease tag dev or latest is refused` (throws)
  - `other branch without prerelease tag is refused` (same error text the workflow prints today)
- [ ] **Step 2:** Run `pnpm --filter vetra test -- release-channel` → FAIL (module missing).
- [ ] **Step 3:** Implement `release-channel.mjs` (ESM, no deps; also runnable as `node release-channel.mjs` reading `GITHUB_REF_NAME`, `INPUT_PRERELEASE_TAG`, `VERSION` env and printing `dist_tag=…` and `registries=…` lines for `$GITHUB_OUTPUT`). In `release.yml`: add the `prerelease-tag` input; replace the branch→tag step and the hard-coded `REGISTRIES` with this script's outputs; main/production behaviour unchanged.
- [ ] **Step 4:** Tests PASS; `actionlint .github/workflows/release.yml` if installed (else `npx --yes @action-validator/cli .github/workflows/release.yml`) → no errors.
- [ ] **Step 5:** Commit `ci: prerelease channel for branch test builds`; push over SSH (`git push git@github.com:powerhouse-inc/vetra-cli.git HEAD:feat/iterate-design`).
- [ ] **Step 6:** Prove the channel: RR-p4 steps 1–4 with `0.0.9-p4.1` (the Projects 2+3 code as merged) → tarball 200 on registry.vetra.io, absent on registry.dev.vetra.io, `p4` tag set, `dev`/`latest` unchanged, image job Complete. Ledger the evidence.

### Task 0.2: P4 staging harness and pinning

**Files (in `/home/f/.claude/jobs/81234be8/tmp/staging-e2e-p4`):**
- Create: clone of `staging-e2e` (`git clone /home/f/.claude/jobs/81234be8/tmp/staging-e2e staging-e2e-p4 && git checkout -b p4`), own `wallet.key`/`profile/` (fresh identity, never the original's), `ops/pin-version.mjs`, `phases/pin-phase.mjs`, `lib/p4.mjs`, `lib/p4.test.mjs`, `README-P4.md`
- Modify: `run.mjs` (`PHASES` gains `pin` and, in later tasks, `story`, `layout`, `point`, `theme`, `remix`, `variants`, `review`, `notes`, `demo`)

**Interfaces:**
- Produces: `pinStudio({ envId, version, wallet }): Promise<{ before: string; after: string }>` (in `ops/pin-version.mjs`, ported from `/home/f/.claude/jobs/81234be8/tmp/e2e-upg-old/ops/pin-version.mts`: Renown credential on renown-staging, read env doc on `switchboard.staging.vetra.io`, full service config with new `package.version`, `setServiceConfig` + `approveChanges` signed `signActionV2`, `MutateDocument`); dependencies resolved from the harness's own `node_modules` (no absolute imports into other worktrees — vendor what is needed into `ops/`).
- `lib/p4.mjs`: `waitAgentVersion(page, version, timeoutMs)` (polls `<studio>/preview/version`), `storyLineCount(page, layer)` (counts rendered lines in the story pane for `Outcome|Activity|Raw`), `p4Env()` (reads `PIN_VERSION`, `P4_STRICT`).
- Phase `pin`: needs `PIN_VERSION`; pins the run's Studio (state.json / `--studio`) and waits for the version → `rec.step("pinned", {before, after})`.

- [ ] **Step 1:** `lib/p4.test.mjs`: `p4Env defaults strict off`, `storyLineCount counts only the visible layer's rows` (fixture HTML via a stub page object).
- [ ] **Step 2:** `node --test lib/p4.test.mjs` → FAIL; implement; PASS.
- [ ] **Step 3:** Fresh identity + fresh Studio: `node run.mjs --phase login` (README "Fresh Studio"); then `PIN_VERSION=0.0.9-p4.1 node run.mjs --phase pin` → summary `pin.ok`, `/preview/version` = `0.0.9-p4.1`. Record the Studio subdomain and env id in the ledger as **P4 test Studio A**.
- [ ] **Step 4:** Commit in the harness repo `feat(p4): own harness copy with version pinning`.

### Task 0.3: studio-product — the P4 fields and operations

**Files:**
- Modify: `vetra-app/document-models/studio-product/studio-product.json` (state schema + operations, then `pnpm --filter vetra-app generate`), `v1/src/reducers/change.ts`, `v1/src/reducers/suggestions.ts`, `v1/src/reducers/product.ts`, `v1/src/normalize.ts`
- Create: `v1/src/reducers/iterate.ts` (new module `iterate`), `v1/tests/iterate.test.ts`
- Test: `v1/tests/change.test.ts`, `v1/tests/suggestions.test.ts`, `v1/tests/normalize.test.ts`, `v1/tests/scenario.test.ts`

**Interfaces (produces; every later task uses these exact names):**

```graphql
# additions to existing types
type Milestone { … outcome: String }                       # ≤ 120 chars, customer-facing
enum SuggestionKind { IDEA REVIEW }
type Suggestion { … kind: SuggestionKind! screenshot: String }   # kind defaults IDEA (normalize); screenshot = attachment ref or URL
type Change { … variants: [Variant!]! }                      # normalize → []
type StudioProductState { …
  origins: [ProductOrigin!]!          # normalize → []
  notes: NotesSettings!               # normalize → { enabled: false, since: null }
  publicSource: PublicSource
  sourceNoticeAcceptedAt: DateTime
}
# new types
enum VariantLabel { A B }
enum VariantStatus { BUILDING READY FAILED KEPT DISCARDED }
type Variant { label: VariantLabel! branch: String! status: VariantStatus! chatSessionId: PHID summary: String }
enum OriginMode { REMIX COMPOSE }
type ProductOrigin { packageName: String! version: String! mode: OriginMode! license: String! sourceUrl: URL sourceRef: String at: DateTime! missing: [String!]! latestVersion: String checkedAt: DateTime }
type NotesSettings { enabled: Boolean! since: DateTime }
enum PublicSourceKind { GITHUB PACKAGE }
type PublicSource { kind: PublicSourceKind! url: URL! version: Int! }
```

Operations:
- `ADD_MILESTONE` input gains `outcome: String` → error `OutcomeTooLongError` (> 120 chars).
- `SET_SUGGESTIONS` unchanged in shape; it replaces only `kind: IDEA` items of that version (REVIEW items survive).
- New module **`iterate`**:
  - `SET_REVIEW_SUGGESTIONS { afterVersion: Int!, items: [SetReviewSuggestionsItemInput!]! }` (`{id: OID!, text: String!, screenshot: String}`) — replaces REVIEW items of that version; 0–3 items; errors `InvalidReviewCountError`, `InvalidReviewTextError` (empty or > 80 chars), `DuplicateReviewIdError`, `UnknownVersionError` (no version with that number).
  - `START_VARIANTS { changeId: OID!, branchA: String!, branchB: String! }` — adds A and B as BUILDING; errors `VariantChangeNotFoundError`, `VariantsExistError` (non-DISCARDED variants already there), `ChangeNotOpenError` (status not BUILDING/READY).
  - `SET_VARIANT_STATUS { changeId: OID!, label: VariantLabel!, status: VariantStatus!, chatSessionId: PHID, summary: String }` — BUILDING→READY|FAILED only; errors `VariantNotFoundError`, `InvalidVariantTransitionError`.
  - `KEEP_VARIANT { changeId: OID!, label: VariantLabel! }` — label → KEPT, other → DISCARDED; requires the kept one READY; errors `VariantNotFoundError`, `VariantNotReadyError`.
  - `SET_ORIGIN { packageName, version, mode, license, sourceUrl, sourceRef, missing: [String!]!, at }` — upsert by `packageName`; error `InvalidOriginError` (empty name/version).
  - `SET_UPSTREAM_VERSION { packageName: String!, latestVersion: String!, checkedAt: DateTime! }` — error `OriginNotFoundError`.
  - `SET_NOTES_ENABLED { enabled: Boolean!, at: DateTime! }` — `since` = `at` when enabling, null when disabling.
  - `ACCEPT_SOURCE_NOTICE { at: DateTime! }`.
  - `SET_PUBLIC_SOURCE { kind, url, version }` — error `InvalidPublicSourceError` (version < 1).

- [ ] **Step 1:** Edit the model JSON (state schema, `initialValue` gains `origins: [], notes: {enabled:false, since:null}, publicSource: null, sourceNoticeAcceptedAt: null`; each new op with schema, errors, reducer code mirroring `src/reducers`), run `pnpm --filter vetra-app generate`; `git status` shows only `studio-product.json`, `schema.graphql`, `gen/**` and new `src/reducers/iterate.ts` stub.
- [ ] **Step 2: Tests** (operation-index pattern for every error): `iterate.test.ts` — one test per op happy path and per error code; `change.test.ts` `milestone keeps a 120-char outcome` and `outcome over 120 chars is refused (state unchanged)`; `suggestions.test.ts` `SET_SUGGESTIONS keeps REVIEW items of the same version`; `normalize.test.ts` `legacy document gains origins, notes, variants and suggestion kind defaults`; `scenario.test.ts` `variants: start → A ready → B ready → keep B` and `remix origin then upstream version`.
- [ ] **Step 3:** Run `pnpm --filter vetra-app test -- studio-product` → FAIL; implement reducers; PASS.
- [ ] **Step 4:** `pnpm --filter vetra-app test:coverage` → all four ≥ 95%; typecheck + lint clean; `pnpm --filter vetra typecheck` (vetra-cli compiles against the new types).
- [ ] **Step 5:** Commit `feat(studio-product): fields for layered story, variants, remix, review and notes`.

---

## M1 — Story in layers (G1)

Milestone start: merge `feat/studio-experience` into `feat/iterate-design`.

### Task 1.1: Tool calls grouped by intent

**Files:**
- Create: `vetra-app/editors/vetra-studio/story/activity.ts`, `story/activity.test.ts`
- Modify: `story/doingNow.ts` (export its tool-name sets so both modules share one table)

**Interfaces:**
- Consumes: `Message`, `ContentPart` (chat-session), `CheckRun` (studio-product), `toolResultsOf` (storyModel).
- Produces:
  - `type Intent = "reading" | "specs" | "code" | "checks" | "preview" | "publishing" | "other"`
  - `toolIntent(toolName: string, args: unknown): Intent` — table (ruling P4-1): `READ_TOOLS`, `SEARCH_TOOLS`, `skill*`, `reactor-project-ls|ps|logs`, `attachment-stat|get` → reading; `spec-*` except `spec-generate` and `spec-preview-*` → specs; `WRITE_TOOLS`, `spec-generate`, `reactor-project-init|build`, `agent-agent*` → code; `reactor-project-check`, shell matching `CHECK_COMMAND` → checks; `reactor-project-start|restart|stop`, `spec-preview-*` → preview; `reactor-project-publish*`, `deploy-*`, `github-*` → publishing; `product-progress` and anything else → other.
  - `activitySummary(messages: readonly Message[], checkRuns: readonly CheckRun[]): string` — one line, intents in the fixed order reading → specs → code → checks → preview → publishing, `other` never shown, joined with ` · `. Copy: reading `Read the project`; specs `Wrote N spec(s)` (N = distinct spec ids/names written, else `Worked on the design`); code `generated code` when `spec-generate` ran, else `wrote N file(s)` (distinct paths); checks `checks passed` / `checks passed after N tries` (N = runs until the first all-pass run, when > 1) / `checks failing` (latest run failing); preview `updated the preview`; publishing `got it ready to go live`. First word capitalised. Empty → `""`.
  - `foldedFailures(checkRuns: readonly CheckRun[]): { recovered: boolean; open: CheckRun | null }` — `open` = latest run if it has any failing result, else null; `recovered` = some earlier run failed and the latest passed.

- [ ] **Step 1: Tests** (`activity.test.ts`): `every tool id the agent can call maps to an intent` (iterate the ids listed in `vetra-cli/src/agents/phase-tools.ts` `ALWAYS_ON` + `PHASE_TOOLS`, copied as a fixture array); `summary of a 60-step milestone is one line` (fixture: 20 reads, 3 spec writes, 1 generate, 30 file writes, 3 check runs fail-fail-pass, 3 preview restarts → `Read the project · Wrote 3 specs · generated code · checks passed after 3 tries · updated the preview`); `latest run failing reads "checks failing"`; `product-progress calls never appear`; `foldedFailures open is the latest failing run`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(story): group the agent's steps by intent`.

### Task 1.2: Three layers over one story model

**Files:**
- Create: `story/storyLayers.ts`, `story/storyLayers.test.ts`
- Modify: `story/storyModel.ts` (milestone line gains `outcome: string | null` and `summary: string`; export `checkLines` unchanged)

**Interfaces:**
- Consumes: Task 1.1 `activitySummary`, `foldedFailures`; Task 0.3 `Milestone.outcome`.
- Produces:
  - `type StoryLayer = "outcome" | "activity" | "raw"`; `DEFAULT_LAYER: StoryLayer = "activity"`
  - `type OutcomeLine = { id: string; at: string; text: string }`
  - `outcomeLines(change: Change): OutcomeLine[]` — one per milestone, `outcome ?? text`.
  - `layerLines(lines: StoryLine[], change: Change, layer: StoryLayer): StoryLine[]`:
    - `raw` → `lines` unchanged (today's view).
    - `activity` → milestone lines keep their `detail` but get `summary = activitySummary(detail, runs in that milestone's window)`; `checks` lines are dropped **except** the latest run when it has failures (open problem); `reply` lines are dropped except: a question, the newest reply, and a reply that directly follows a steer (first ASSISTANT text after a USER steer); `steer`, `stuck`, `attention`, `paused`, `waiting`, `idea` and the active line stay.
    - `outcome` → `idea` + outcome lines rendered as `milestone` lines with `text = outcome ?? text`, plus `stuck`/`attention`/question lines (anything waiting for the customer).
- [ ] **Step 1: Tests** (`storyLayers.test.ts`, fixtures from `storyFixtures.ts`): `a 60-step change shows at most 12 activity lines` (G1; fixture of 5 milestones, 60 tool calls, 6 interim replies, 4 check runs with two recovered failures); `latest failing run stays its own line while an earlier failure folds` (Review Focus 1); `question and the reply to a steer stay in activity`; `outcome layer falls back to the milestone title`; `raw layer equals storyLines`; `stuck and needs-you stay in every layer`.
- [ ] **Step 2:** FAIL → implement → PASS (`pnpm --filter vetra-app test -- story`); existing `storyModel.test.ts` still green.
- [ ] **Step 3:** Commit `feat(story): outcome, activity and raw layers`.

### Task 1.3: The agent writes outcomes

**Files:**
- Modify: `vetra-cli/src/commands/product/progress.ts` (input `outcome`, passed to `addMilestone`), `vetra-cli/prompts/agent-profiles/workflow.md` (milestone rule), - Test: `vetra-cli/tests/product/progress.test.ts`

**Interfaces:**
- Consumes: Task 0.3 `ADD_MILESTONE.outcome`.
- Produces: `product-progress` `milestone` action takes optional `outcome` (≤ 120 chars, customer-facing sentence, e.g. `Notes can now carry tags`); refused with `Keep the outcome to one sentence of at most 120 characters.` when longer; forbidden words are checked on it like `text`.
- [ ] **Step 1: Tests:** `milestone passes outcome through`; `outcome over 120 chars is refused with the one-sentence message`; `outcome with a forbidden word is refused` (uses `findForbiddenWords`).
- [ ] **Step 2:** FAIL → implement (describe the field in the zod schema; prompt line in `workflow.md`: "With every milestone, add `outcome`: one sentence for the customer about what they can now do, e.g. 'Notes can now carry tags'.") → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(agent): customer-facing outcome on milestones`.

### Task 1.4: Layer switch in the story pane

**Files:**
- Modify: `story/StoryPane.tsx`, `story/StoryPane.test.tsx`
- Create: `story/LayerSwitch.tsx`, `story/copyAll.ts`, `story/copyAll.test.ts`

**Interfaces:**
- Consumes: Task 1.2 `layerLines`, `outcomeLines`, `StoryLayer`, `DEFAULT_LAYER`.
- Produces: `StoryPaneProps` gains `layer?: StoryLayer` and `onLayerChange?(layer)` (controlled by Task 2.3; uncontrolled default `activity`); `LayerSwitch({ value, onChange })` — segmented control, labels exactly `Outcome`, `Activity`, `Raw`, `role="tablist"`; milestone rows in Activity render `summary` under the text (muted, one line, truncate); `copyAllText(lines: StoryLine[], results): string` — plain-text dump of every line and its detail (tool name, args JSON, result text), for the Raw layer's `Copy all` button (copies via `navigator.clipboard.writeText`, toast `Copied` / `Couldn't copy`).
- [ ] **Step 1: Tests:** `StoryPane` `defaults to Activity`; `switching to Raw shows every tool call`; `Outcome shows one sentence per milestone`; `Copy all is only in Raw`; `copyAll.test.ts` `includes every tool call and its result`. Forbidden words checked with `expectNoForbiddenWords` on Activity and Outcome renders.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(story): switch between outcome, activity and raw`.

### Task 1.5: While you were away

**Files:**
- Create: `story/awayCard.ts`, `story/awayCard.test.ts`, `story/AwayCard.tsx`, `story/AwayCard.test.tsx`
- Modify: `story/StoryPane.tsx` (card above the lines), `shell/StudioShell.tsx` (passes `studioId = drive.header.id`)

**Interfaces:**
- Produces: `LAST_VISIT_KEY = (studioId: string) => \`vetra-studio:last-visit:${studioId}\``; `readLastVisit(studioId): number | null`, `writeLastVisit(studioId, ms)` (try/catch); `awaySummary(product: StudioProductState, since: number): { outcomes: OutcomeLine[]; waiting: string[] } | null` — outcomes of milestones (all changes) with `at > since`, waiting = open question text / needs-you reasons / READY change (`Your change is ready to go live.`); null when both empty. Card heading `While you were away`, dismiss button `Got it` (writes last visit = now). The last visit is written on dismiss and on `pagehide`/unmount, never on first render (so the card shows on open).
- [ ] **Step 1: Tests:** `no card on the first ever visit` (no stored timestamp → null and nothing rendered; stores now on unmount); `lists outcomes since the last visit`; `lists a ready change as waiting for you`; `Got it hides it and stores the time`; `blocked storage renders nothing and does not throw`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(story): while you were away`.

### Task 1.6: M1 acceptance on staging

**Files (harness):** Create `phases/story-phase.mjs`; Modify `run.mjs`, `README-P4.md`.

- [ ] **Step 1:** Phase `story` (P4/M1, Task 1.6 — G1): on the pinned Studio, request a change that runs ≥ 60 agent steps (`STORY_REQUEST`, default `Add a tags field to each item and a filter by tag`; steps counted from the product doc `metrics.steps`, or chat tool calls); assert Activity ≤ 12 lines (`storyLineCount`), each recovered check failure appears in a summary not as its own line, Outcome lines contain no forbidden words, Raw line/tool count = chat tool calls; reload with a stored last-visit older than the change → `While you were away` lists the outcome lines. Metrics `g1ActivityLines`, `g1Steps`.
- [ ] **Step 2:** RR-p4 (`0.0.9-p4.2`), pin Studio A, `node run.mjs --phase story --studio <A>` → `story.ok`. Fix forward in a new task branch if red (each fix is a normal task loop).
- [ ] **Step 3:** Commit harness `feat(p4): story phase (G1)`; report M1 green with evidence (summary excerpt, screenshot paths).

---

## M2 — Layout modes (G2)

Milestone start: merge `feat/studio-experience`.

### Task 2.1: Layout preferences

**Files:** Create `shell/layoutPrefs.ts`, `shell/layoutPrefs.test.ts`

**Interfaces:**
- Produces: `type LayoutMode = "build" | "review" | "demo"`; `type Dock = "left" | "right" | "bottom"`; `type LayoutPrefs = { mode: LayoutMode | null; dock: Dock; size: number }` (`size` = chat/story pane share in %, 20–70); `LAYOUT_KEY = (studioId) => \`vetra-studio:layout:${studioId}\``; `readLayout(studioId): LayoutPrefs` (defaults `{mode:null, dock:"left", size:38}`, falls back to legacy `vetra-studio:story-width` for `size`, clamps, ignores garbage); `writeLayout(studioId, prefs)`; `effectiveMode(prefs, { live: boolean }): LayoutMode` — stored mode, else `build` while not live, `review` once live; Review/Demo default dock `right`, Build `left`, applied only when the stored dock was never set by the customer (store `dockSet: boolean`).
- [ ] **Step 1: Tests:** `defaults: build while building, review once live`; `remembers mode, dock and size per Studio`; `legacy story width becomes the size`; `garbage and out-of-range values fall back`; `blocked storage still yields defaults`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(shell): layout preferences per Studio`.

### Task 2.2: Dockable, resizable split

**Files:** Create `shell/DockSplit.tsx`, `shell/DockSplit.test.tsx`; Modify `shell/StudioShell.tsx` (replace `BuildSplit` with `DockSplit`; delete `BuildSplit`, `readStoryWidth`/`writeStoryWidth`)

**Interfaces:**
- Consumes: Task 2.1.
- Produces: `DockSplit({ dock, size, onResize(size), side: ReactNode, main: ReactNode, sideLabel: string })` — `side` is the story/chat pane docked left/right/bottom; separator `role="separator"`, `aria-orientation` vertical for left/right, horizontal for bottom; mouse drag + keyboard (`ArrowLeft/Right` or `ArrowUp/Down` ±2 %), double-click resets to 38; the iframe-shield overlay during drag stays; `onResize` fires once per drag end.
- [ ] **Step 1: Tests:** `docks left, right and bottom` (DOM order + flex direction); `drag reports one size at the end`; `keyboard resizes`; `double-click resets`; existing StudioShell tests green.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(shell): dock the story left, right or bottom`.

### Task 2.3: Mode switch, Build and Review

**Files:** Create `shell/ModeSwitch.tsx`, `shell/ModeSwitch.test.tsx`, `shell/ReviewLayout.tsx`, `shell/ReviewLayout.test.tsx`, `shell/useLayout.ts`; Modify `shell/StudioShell.tsx`, `strip/StepStrip.tsx` (a slot on the right for the mode switch)

**Interfaces:**
- Consumes: Tasks 1.4 (`layer` prop), 2.1, 2.2.
- Produces: `useLayout(studioId, live): { mode, dock, size, setMode, setDock, setSize }`; `ModeSwitch({ mode, onMode, dock, onDock, attention: number })` — three buttons `Build`, `Review`, `Demo` (`aria-pressed`), a dock menu `Chat on the left|right|bottom` (Build/Review only), a badge with `attention` count; `ReviewLayout({ product: ReactNode, side: ReactNode, dock, size, onResize, panel?: ReactNode })` — product in the middle at full height, `side` = the story at `layer="outcome"` with a `Show activity` toggle switching to `activity`, plus the steer box; `panel` = optional right-hand side panel slot (Theme panel, Task 4.3). The product node: the live view (`LiveSurface`) once live and no change is open, else the preview pane. Build mode = today's page, using `DockSplit`.
- [ ] **Step 1: Tests:** `one click switches Build → Review → Demo`; `Review shows the product full height and the story in Outcome`; `Show activity switches the layer`; `the steer box and a pending question stay visible in Build and Review` (render with a question line); `mode is remembered after remount`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(shell): Build and Review modes`.

### Task 2.4: Demo mode and the command bar

**Files:** Create `shell/DemoLayout.tsx`, `shell/CommandBar.tsx`, `shell/CommandBar.test.tsx`, `shell/commandKeys.ts`, `shell/commandKeys.test.ts`; Modify `shell/StudioShell.tsx`

**Interfaces:**
- Produces: `isCommandShortcut(e: KeyboardEvent, platform: string): boolean` (⌘K on mac, Ctrl-K elsewhere; ignores when focus is in an editable inside the product frame — the frame is a separate document, so only the parent's own inputs matter); `CommandBar({ open, onClose, onSend(text): Promise<void>, lastReply: string | null, pending: string | null })` — one input (placeholder `Ask for a change…`), Enter sends via the same path the story uses (`sendSteer` into the open change, else `startChange` kind CHANGE), Esc closes, last agent reply shown as a toast (`usePHToast`, info) when it arrives; `DemoLayout({ product, bar })` — product full screen, the step strip replaced by a thin bar (product name, live dot, `Open chat` → mode `review`, mode switch).
- [ ] **Step 1: Tests:** `Ctrl-K and ⌘K open the bar, plain K does not`; `Enter sends into the open change`; `with no open change Enter starts a change`; `the newest reply shows as a toast`; `Open chat goes to Review`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(shell): Demo mode with a command bar`.

### Task 2.5: Nothing waiting is ever hidden

**Files:** Create `shell/attention.ts`, `shell/attention.test.ts`; Modify `shell/StudioShell.tsx`, `shell/ModeSwitch.tsx`

**Interfaces:**
- Produces: `attentionItems(lines: StoryLine[], failure: unknown | null): { id: string; text: string }[]` — open question, needs-you/stopped steps, stuck, a failure row; `useAttentionToasts(items, mode)` — when mode is `demo` or the story is collapsed, each new item id fires one toast (`warning`) with its text and an action `Open chat` → Review; the mode switch badge shows `items.length`.
- [ ] **Step 1: Tests:** `a question in Demo shows a badge and one toast`; `the same item never toasts twice`; `Build with the story visible shows no toast`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(shell): questions surface in every mode`.

### Task 2.6: M2 acceptance on staging

**Files (harness):** `phases/layout-phase.mjs`, `run.mjs`, `README-P4.md`.

- [ ] **Step 1:** Phase `layout` (G2): switch Build → Review → Demo each by one click; dock right, bottom, left and drag the separator; reload → same mode/dock/size; Demo: Ctrl-K, send `Make the title bigger`, the reply toast appears; a question asked by the agent (steer `Ask me which colour I prefer before changing anything`) shows the badge + toast in Demo; the steer box is present in Build and Review.
- [ ] **Step 2:** RR-p4, pin, run `--phase layout` → green. Commit `feat(p4): layout phase (G2)`; report M2.

---

## M3 — Point and change (G3)

Milestone start: merge `feat/studio-experience`.

### Task 3.1: The selection layer

**Files:** Create `preview/pointLayer.ts`, `preview/pointLayer.test.ts`; Modify `BuildSection.tsx` (`PreviewBody` gets `frameRef?: React.Ref<HTMLIFrameElement>`), `preview/PreviewPane.tsx` (exposes the frame ref + `point` toggle state)

**Interfaces:**
- Produces: `attachPointLayer(frame: HTMLIFrameElement, handlers: { onSelect(el: Element): void; onEditText(el: Element): void; onExit(): void }): () => void` — direct DOM via `frame.contentDocument` (ruling P4-6: no injected script); hover outline is one absolutely positioned `div[data-vetra-point-overlay]` appended to the frame's `body` with `pointer-events:none`; listeners registered in capture phase with `{ capture: true }` and the click/dblclick **prevented and stopped only while attached**; Esc → `onExit`; re-attaches on the frame's `load` (navigation) and detaches cleanly; returns `detach`. Cross-origin frame (no `contentDocument`) → returns a no-op detach and `onExit()`.
- `PreviewPane` shows a toggle button `Point` (`aria-pressed`), hidden when the frame is cross-origin.
- [ ] **Step 1: Tests** (happy-dom, same-document iframe): `hover moves the outline over the element`; `click selects without reaching the product handler`; `detach removes every listener and overlay; product click handler fires again` (Review Focus 2); `Esc exits`; `frame navigation re-attaches`; `cross-origin frame is a no-op`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(preview): point at an element in the preview`.

### Task 3.2: What the agent gets about an element

**Files:** Create `preview/pointTarget.ts`, `preview/pointTarget.test.ts`, `preview/pointShot.ts`; Modify `vetra-app/package.json` (add `html-to-image@1.11.13`)

**Interfaces:**
- Produces:
  - `type PointTarget = { text: string; tag: string; role: string | null; label: string | null; path: string[]; rect: { x: number; y: number; width: number; height: number }; component: string | null; field: string | null; module: string | null; document: { type: string; id: string } | null }`
  - `describeElement(el: Element, context: { screen: PreviewScreen | null }): PointTarget` — text trimmed to 200 chars; `path` = up to 5 ancestors as `tag.data-vetra-component|#id|.firstClass`; `component`/`field` from the nearest `data-vetra-component` / `data-vetra-field`; `module`/`document` from the preview's current screen (`previewTabs` screen: editor module + document type/id).
  - `pointShot(frame: HTMLIFrameElement, el: Element): Promise<Blob | null>` — `html-to-image` `toBlob` of the element's nearest ancestor ≥ 120×80 px, max 1200 px wide; null on any error (never blocks the request).
  - `pointContextText(target: PointTarget): string` — the block appended to the customer's request, exact shape:
    ```
    [Pointed at] <tag> "<text>"
    Component: <component|unknown> · Field: <field|unknown>
    Screen: <module|unknown> · Document: <type> <id>
    Where: <path joined with " › "> · <width>×<height> at <x>,<y>
    ```
- [ ] **Step 1: Tests:** `reads component and field attributes from ancestors`; `falls back to text and ancestor path without attributes`; `text is trimmed to 200 characters`; `context text has the exact four lines`; `pointShot returns null when rendering fails`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(preview): describe the pointed element for the agent`.

### Task 3.3: "Change this"

**Files:** Create `preview/ChangeThis.tsx`, `preview/ChangeThis.test.tsx`, `preview/sendPointRequest.ts`, `preview/sendPointRequest.test.ts`; Modify `preview/PreviewPane.tsx`; Modify `vetra-cli/prompts/agent-profiles/workflow.md` (how to read `[Pointed at]`)

**Interfaces:**
- Consumes: Tasks 3.1, 3.2; `startChange` / `sendSteer`; the chat attachment upload: `useDriveAttachments()` in `ChatPane.tsx:159` (`createRemoteAttachmentService` from `@powerhousedao/reactor-attachments`: `reserve({mimeType, fileName})` then `send(stream)` → `ref`); move it to `hooks/useDriveAttachments.ts` and import it from both places. The screenshot goes in the user message as a content part `{ type: "IMAGE", filename: "pointed.png", mediaType: "image/png", attachment: ref }`.
- Produces: `ChangeThis({ target, shot, onSend(text), onCancel })` — popover anchored at the element rect (in parent coordinates), heading `Change this`, textarea placeholder `What should change here?`, buttons `Send` / `Cancel`, shows the element text; `sendPointRequest({ request, target, shot, drive, productId, openChange }): Promise<void>` — message text = request + `\n\n` + `pointContextText(target)`, screenshot attached when present; open change → steer, else `startChange` kind `CHANGE` with that text. Prompt rule: "A `[Pointed at]` block names the exact element the customer means — change that element; don't ask where it is."
- [ ] **Step 1: Tests:** `Send starts a change with the request and the pointed context`; `Send steers into the open change`; `a failed screenshot still sends`; `Cancel sends nothing`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(preview): change this — requests attached to an element`.

### Task 3.4: Studio-made edits as normal changes (server side)

**Files:** Create `vetra-cli/src/product/studio-edit.ts`, `vetra-cli/src/preview-server/iterate-routes.ts`, `vetra-cli/tests/product/studio-edit.test.ts`, `vetra-cli/tests/preview-server/iterate-routes.test.ts`; Modify `vetra-cli/src/preview-server/server.ts` (one line: `if (await iterateRoutes.handle(req, res, url, method)) return;` before the 404), `vetra-cli/src/preview-server/index.ts` (pass `ProductContext` + workdir)

**Interfaces:**
- Consumes: `dispatchProduct`, `getProductDoc`, `activeChange` (`product/product-doc.ts`); `prepareChangeBase` (`product/changes.ts`); `runChecks`, `checkResultsFromOutcome` (`helpers/project-checks.ts`); `recordCheckRun` (`lifecycle/check-recorder.ts`); `projectDirs` (`launch/git-versions.ts`).
- Produces:
  - `applyStudioEdit(ctx: StudioEditContext, edit: { request: string; milestone: string; outcome: string; write(workdir: string): Promise<string[]> }): Promise<{ changeId: string; sha: string; checksPassed: boolean }>` — joins the open change (BUILDING/READY/PAUSED) or starts one (`START_CHANGE` kind `CHANGE`, `request`, no chat message, no agent turn) after `prepareChangeBase`; runs `write`; commits the returned files (`git commit -m "<milestone>"`, Studio author); runs checks (`runChecks` scope `all`) and records them (`RECORD_CHECK_RUN`); adds the milestone (`ADD_MILESTONE` text + outcome); for a change it started: `PLAN_STEPS [TESTS]`, `START_STEP TESTS`, `COMPLETE_STEP TESTS` when checks pass → READY; failing checks → `SET_STEP_ATTENTION` with the first reason and a studio note to the agent session (`studio-note-` prefix) asking it to fix. Serialised with the project lock (`helpers/project-lock.ts`).
  - `createIterateRoutes(deps: IterateRouteDeps): { handle(req, res, url, method): Promise<boolean> }` — owner gate on every route via the server's `requireOwner`; JSON in/out; this task registers no feature route except `GET /iterate/healthz` (owner) returning `{ ok: true }`; later tasks add routes here.
- [ ] **Step 1: Tests:** `starts a change without an agent turn and makes it ready when checks pass`; `joins the open change instead of starting one`; `failing checks put the change on needs-you and notify the agent`; `edits are serialised`; route test `iterate routes refuse a caller without the owner token` (401/403) and `owner gets ok`.
- [ ] **Step 2:** FAIL → implement → PASS; vetra-cli typecheck/lint. Commit `feat(studio): hand edits become normal changes`.

### Task 3.5: Edit text in place

**Files:** Create `vetra-cli/src/product/text-edit.ts`, `vetra-cli/tests/product/text-edit.test.ts`, `vetra-app/editors/vetra-studio/preview/inlineText.ts`, `preview/inlineText.test.ts`, `hooks/iterate-client.ts`; Modify `iterate-routes.ts` (`POST /iterate/text`), `preview/PreviewPane.tsx`

**Interfaces:**
- Consumes: Task 3.4 `applyStudioEdit`; Task 3.1 `onEditText`; Task 3.3 `sendPointRequest`.
- Produces:
  - `findLiteral(workdir: string, text: string): { file: string; index: number }[]` — searches every reactor project's `editors/`, `apps/`, `document-models/*/src/` (never `gen/`, `node_modules/`, `*.test.*`, `dist/`) for the exact literal as a whole JSX text node or a whole string literal (`"…"`, `'…'`, `` `…` `` without `${`); HTML-entity and whitespace normalised comparison.
  - `POST /iterate/text { oldText, newText }` → exactly one match: `applyStudioEdit` with milestone `Changed label '<old>' → '<new>'` (outcome the same), replies `{ applied: true, changeId }`; else `{ applied: false, matches: n }` (nothing written).
  - `iterate-client.ts`: `editText(oldText, newText): Promise<{ applied: boolean; matches?: number }>` (pattern of `fetchProjectPackage`: `resolvePreviewConfig` + `ownerHeaders`).
  - `inlineText.ts`: `startInlineEdit(el: HTMLElement, onDone(newText | null))` — sets `contenteditable="plaintext-only"` on a text-only element (else returns false), Enter commits, Esc cancels, blur cancels; always restores the original attribute state. `PreviewPane`: applied → toast `Changed '<old>' to '<new>'`; not applied → opens `ChangeThis` prefilled `Change the text '<old>' to '<new>'`.
- [ ] **Step 1: Tests:** `exactly one JSX text match is applied`; `literal also present inside a longer string counts as ambiguous` (Review Focus 3); `literal only in gen/ is not found`; `two matches go to the agent`; `inline edit restores the element on Esc`; `non-text elements are not editable`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(studio): edit text in place`.

### Task 3.6: Findable components and fields in generated editors

**Files:** Modify `vetra-cli/prompts/skills-tpl/document-editor-creation/01.write-editor-implementation.md` (new section **Markers for the Studio**), `vetra-cli/prompts/skills-tpl/drive-app-creation/01.write-app-implementation.md` (same), Create `vetra-cli/src/product/marker-check.ts` + test `vetra-cli/tests/product/marker-check.test.ts`; wire as a note (not a failure) in `commands/reactor-project/check.ts` output.

**Interfaces:**
- Produces: the rule text — "Give the root element of every drive app `data-vetra-app` and of every editor and app `data-vetra-component=\"<ComponentName>\"`, every reusable component's root `data-vetra-component=\"<ComponentName>\"`, and every element that shows or edits one document field `data-vetra-field=\"<field.path>\"` (e.g. `notes.0.title` → use the schema path without indexes: `notes.title`)."; `missingMarkers(projectPath): string[]` — editor/app root files whose JSX has no `data-vetra-component`; the check prints `Add data-vetra-component to: <files>` as a note.
- [ ] **Step 1: Tests:** `lists editors without a component marker`; `a marked editor passes`; skill-template build test (`pnpm --filter vetra build:assets` then grep the built skill for `data-vetra-field`).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(agent): stable markers for components and fields`.

### Task 3.7: M3 acceptance on staging

**Files (harness):** `phases/point-phase.mjs`, `run.mjs`, `README-P4.md`.

- [ ] **Step 1:** Phase `point` (G3): Review mode → `Point` → hover shows the outline inside the frame → click a card title → `Change this` → `Make this bold` → the agent's change touches that element (story Outcome mentions it; no question back asking where); double-click a heading, type new text, Enter → toast `Changed …`, story line `Changed label '…' → '…'`, no new agent message in the chat, the change is READY; Point off → clicking a product button works again (the product's own handler: e.g. "Add" creates an item). On a live product: Review shows the preview of the live version with Point available.
- [ ] **Step 2:** RR-p4, pin, run → green. Commit `feat(p4): point phase (G3)`; report M3.

---

## M4 — A look of its own (G4)

Milestone start: merge `feat/studio-experience`.

### Task 4.1: The theme model

**Files:** Create `vetra-app/editors/vetra-studio/theme/theme.ts`, `theme/theme.test.ts`, `theme/fonts.ts`

**Interfaces:**
- Consumes: `BrandSheetState` (`document-models/brand-sheet`).
- Produces:
  - `type ThemeColors = { background; foreground; card; cardForeground; muted; mutedForeground; accent; accentForeground; primary; primaryForeground; border }` (all hex strings)
  - `type Theme = { version: 1; light: ThemeColors; dark: ThemeColors; radius: number /* rem, 0–1.5 */; density: number /* 0.75–1.25 spacing scale */; fonts: { heading: string; body: string } }`
  - `DEFAULT_THEME: Theme` (today's design-system values, so a product without a theme file looks exactly as today)
  - `themeFromBrand(brand: BrandSheetState | null): Theme` — PRIMARY → primary (+ readable foreground by contrast), SURFACE → background/card (dark derived by lightness inversion), ACCENT → accent, TEXT → foreground, SECONDARY → muted; HEADLINE/BODY typefaces when they are in `CURATED_FONTS`, else the closest curated fallback by category; missing roles keep defaults.
  - `type Preset = "calmer" | "bolder" | "denser" | "roomier"`; `applyPreset(theme, preset): Theme` — deterministic: calmer = saturation −25 %, radius +0.25; bolder = saturation +25 %, primary lightness −8 %, heading font weight via font choice, radius −0.125; denser = density −0.125; roomier = density +0.125; all clamped; idempotence not required, but `applyPreset(t,"denser")` then `"roomier"` returns `t`'s density.
  - `themeCss(theme, scope: string): string` — the raw design-system variables (`--background`, `--foreground`, `--card`, `--card-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--primary`, `--primary-foreground`, `--border`, `--input` (= border), `--ring` (= primary), `--radius`), `--spacing` scaled by density, `--font-sans` (body) and `--font-heading` under `${scope}` (light) and `:where(.dark) ${scope}` (dark), plus the Google Fonts `@import` for curated fonts (first line). Variable names as in `@powerhousedao/design-system/theme.css` `:root` (line 239) / `.dark` (line 286).
  - `CURATED_FONTS` (ruling P4-8): Inter, Manrope, IBM Plex Sans, Source Serif 4, Fraunces, Space Grotesk, DM Sans, Lora, JetBrains Mono, Nunito — each `{ family, category: "sans"|"serif"|"mono", css: string }`.
  - `contrastRatio(a: string, b: string): number`.
- [ ] **Step 1: Tests:** `default theme reproduces today's tokens`; `brand primary and surface map to tokens with readable foregrounds (contrast ≥ 4.5)`; `unknown brand font falls back to a curated one of the same category`; `presets are deterministic and clamped`; `denser then roomier restores density`; `theme css only targets the scope selector, never :root or html` (Review Focus 4).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(theme): theme model, brand derivation and presets`.

### Task 4.2: The theme ships in the product

**Files:** Create `vetra-cli/src/product/theme-file.ts`, `vetra-cli/tests/product/theme-file.test.ts`; Modify `iterate-routes.ts` (`GET /iterate/theme`, `PUT /iterate/theme`), `vetra-app/editors/vetra-studio/hooks/iterate-client.ts` (`getTheme`, `putTheme`)

**Interfaces:**
- Consumes: Task 4.1 `Theme`, `themeCss` (imported from `vetra-app/editors/vetra-studio/theme/theme.js` — vetra-cli already depends on `vetra-app`); Task 3.4 `applyStudioEdit`.
- Produces:
  - Files per reactor project: `theme/theme.json` (the `Theme`) and `theme/theme.css` (`themeCss(theme, themeScope(editorIds))`), header comment `/* Written by Vetra Studio — edit it in the Theme panel. */`; `ensureThemeImport(projectPath)` makes `@import "./theme/theme.css";` the first import of the project's own `style.css` (idempotent; Connect already loads package CSS in `layer(external-packages)`).
  - Scope (ruling P4-7, designer's call "editors and app only"): `themeScope(editorIds: string[]): string` = `:is(#document-editor-context[data-editor="<id1>"], …, [data-vetra-app])` — Connect wraps each package editor in `<div id="document-editor-context" data-editor={editor id}>` (connect `router` `DocumentEditor`); drive apps have no stable wrapper, so app roots carry `data-vetra-app` (Task 3.6 rule). Editor ids come from the project's manifest/`editors/*/module.ts`. The CSS redefines the **raw** design-system variables (`--background`, `--foreground`, `--card`, `--card-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--primary`, `--primary-foreground`, `--border`, `--input`, `--ring`, `--radius`), because design-system maps `--color-x: var(--x)` inline, so a subtree override re-themes only that subtree.
  - `GET /iterate/theme` → `{ theme: Theme | null, derived: Theme }` (`derived` from the Studio drive's brand sheet when no file exists); `PUT /iterate/theme { theme, label }` → `applyStudioEdit` with milestone `Changed the look: <label>` (label e.g. `bolder`, `custom colours`) writing both files in every reactor project; `{ changeId }`.
  - Launch: `publish-all` includes `theme/` (verify the package `files`/build copies `style.css` imports; add `theme` to the build input if needed).
- [ ] **Step 1: Tests:** `writes theme.json and theme.css and imports it once`; `PUT makes a change with the look milestone`; `GET derives from the brand sheet when no file exists`; `the built package contains the theme css` (build a fixture project with `ph build` skipped: assert the `style.css` import and file list given to the packer).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(theme): the theme ships inside the product`.

### Task 4.3: Theme panel

**Files:** Create `theme/ThemePanel.tsx`, `theme/ThemePanel.test.tsx`, `theme/liveTheme.ts`, `theme/liveTheme.test.ts`; Modify `shell/StudioShell.tsx` (Review mode `panel` slot, a `Theme` button in the mode bar)

**Interfaces:**
- Consumes: Tasks 2.3 (`panel` slot), 4.1, 4.2 client.
- Produces: `injectTheme(frame: HTMLIFrameElement, css: string): () => void` — one `<style data-vetra-theme-preview>` appended last in the frame head (same-origin only; no-op otherwise), returns remove; `ThemePanel({ frame, initial: Theme, onKeep(theme, label): Promise<void>, onClose })` — sections: swatches per token (light/dark toggle `Light` / `Dark`), heading + body font pickers (curated list), `Corners` slider (radius), `Spacing` slider (density), preset buttons `Calmer`, `Bolder`, `Denser`, `Roomier`; every change re-injects live; `Keep` → `putTheme` (label = last preset or `custom look`) → toast `Kept — it's part of your change now.`; `Reset` reverts to the initial theme and removes the injected style; closing without Keep removes the injection.
- [ ] **Step 1: Tests:** `a preset restyles the preview frame live`; `Keep saves through the Studio and closes`; `closing without Keep leaves the preview as it was`; `injectTheme is a no-op on a cross-origin frame`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(theme): theme panel with live preview`.

### Task 4.4: The agent uses presets

**Files:** Create `vetra-cli/src/commands/product/theme.ts` (tool `product-theme`), `vetra-cli/tests/product/theme.test.ts`; Modify `vetra-cli/src/commands/product/index.ts`, `vetra-cli/src/agents/phase-tools.ts` (ALWAYS_ON), `vetra-cli/prompts/agent-profiles/workflow.md`, `vetra-app/editors/vetra-studio/story/doingNow.ts` + `story/activity.ts` (`product-theme` → "changing the look…", intent `code`)

**Interfaces:**
- Produces: tool `product-theme` input `{ action: "preset" | "set", preset?: Preset, theme?: Partial<Theme> }` → writes the theme files in the workspace (the agent's own turn commits as usual — no `applyStudioEdit`), returns the resulting theme summary; prompt rule: "Requests about the overall look ('make it bolder', 'calmer', 'more compact', 'more space') use `product-theme` with the matching preset first; never hand-edit `theme/theme.css`."
- [ ] **Step 1: Tests:** `preset bolder rewrites theme.json and theme.css`; `set merges colours`; `unknown preset is refused`; `phase-tools exposes product-theme always`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(agent): change the look with theme presets`.

### Task 4.5: M4 acceptance on staging

**Files (harness):** `phases/theme-phase.mjs`, `run.mjs`, `README-P4.md`.

- [ ] **Step 1:** Phase `theme` (G4): Review → `Theme` → `Bolder` → preview frame's computed `--color-primary` changes within 1 s and the Connect toolbar outside the editor keeps its colour; `Keep` → story line `Changed the look: bolder`, change READY, `Make it live` → the live product's editor root has the new computed primary; Go back to the previous version → old colour; steer `make it calmer` → agent calls `product-theme` (chat tool call name).
- [ ] **Step 2:** RR-p4, pin, run → green. Commit `feat(p4): theme phase (G4)`; report M4.

---

## M5 — Remix & compose (G5)

Milestone start: merge `feat/studio-experience`.

### Task 5.1: Browse published packages

**Files:** Create `vetra-cli/src/remix/registry.ts`, `vetra-cli/tests/remix/registry.test.ts`, `vetra-app/editors/vetra-studio/remix/PackagePicker.tsx`, `remix/PackagePicker.test.tsx`, `remix/licence.ts`, `remix/licence.test.ts`; Modify `iterate-routes.ts` (`GET /iterate/packages?q=`), `idea/IdeaScreen.tsx` (entry `Start from an existing product`), `change/ChangeDrawer.tsx` (entry `Add from an existing product`), `hooks/iterate-client.ts`

**Interfaces:**
- Produces:
  - `searchPackages(q: string, deps): Promise<PackageCard[]>` — `GET https://registry.vetra.io/-/v1/search?text=<q>&size=50` (empty `q` lists local packages), keeps only packages whose latest manifest (`<pkg>/<latest>` → `dist/powerhouse.manifest.json` via the package's `./manifest` export, fetched from the tarball listing or unpkg-style `/-/` is not available → read the manifest from the packument's `powerhouse` field if present, else download and read the tarball manifest, cached by `name@version` on disk under `.ph/vetra/remix-cache/`) declares ≥ 1 document model; excludes `vetra`, `vetra-app`, `vetra-cli`, `@vetra-apps/product-notes` and the Studio's own product package.
  - `type PackageCard = { name: string; description: string | null; version: string; license: string | null; documentModels: string[]; remixable: boolean }`
  - `licenceAllowsRemix(spdx: string | null): boolean` — true for AGPL-*, GPL-*, LGPL-*, MIT, Apache-2.0, BSD-*, ISC, MPL-2.0 (also `-only`/`-or-later` forms); false for null/UNLICENSED/proprietary/unknown.
  - `PackagePicker({ onRemix(card), onCompose(card), onClose })` — search box, list rows (name, description, models, version), buttons `Remix` (only when `remixable`) and `Use as is` (Compose); a non-remixable row says `Its licence only allows using it as is.`
- [ ] **Step 1: Tests:** `lists knowledge-note with its document models` (fixture packument + manifest JSON from `/home/f/.claude/jobs/81234be8/tmp/p4-research/kn`, copied into `tests/fixtures/remix/` trimmed); `packages without document models are hidden`; licence table cases incl. `AGPL-3.0-only` → true, `UNLICENSED` → false; picker `Remix hidden for a non-remixable licence`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): browse published products`.

### Task 5.2: Recover the source

**Files:** Create `vetra-cli/src/remix/source.ts`, `vetra-cli/src/remix/curated-sources.ts`, `vetra-cli/tests/remix/source.test.ts`

**Interfaces:**
- Produces:
  - `CURATED_SOURCES: Record<string, { repo: string }>` = `{ "@powerhousedao/knowledge-note": { repo: "https://github.com/apeiron-M/bai-knowledge-note" } }`
  - `type RecoveredSource = { kind: "repo"; url: string; ref: string; dir: string } | { kind: "sourcemaps"; dir: string; missing: string[] }`
  - `recoverSource(pkg: string, version: string, into: string, deps): Promise<RecoveredSource | null>` — order (spec §5.5): (1) `repository` field, else `CURATED_SOURCES` → shallow clone; `ref` = the commit whose `package.json` `version` equals `version` (tag `v<version>` or `<version>` first, else `git log -S'"version": "<version>"' -- package.json` newest), else the default branch HEAD with `missing` noting `exact version <version> not found in the repository; used <sha>`; (2) else unpack the tarball and rebuild files from `sourcesContent` of every `.map` (skip `node_modules/`), reconstructing `document-models/<m>/<m>.json` specs from the bundle-embedded spec objects when `<m>.json` is missing (parse the `specifications` literal with a JSON5 parser over the extracted object text) and listing every manifest model/editor/processor/subgraph without recovered source in `missing`; (3) else null.
- [ ] **Step 1: Tests:** `curated repo wins when there is no repository field`; `picks the commit matching the version` (fixture git repo built in the test with two version commits); `no matching version falls back to HEAD and says so`; `source maps rebuild reducers and list a missing editor` (fixture tarball dir with two `.map` files); `nothing recoverable returns null`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): recover a package's source`.

### Task 5.3: Remix into the workspace

**Files:** Create `vetra-cli/src/remix/remix.ts`, `vetra-cli/src/remix/remix-md.ts`, `vetra-cli/tests/remix/remix.test.ts`; Modify `iterate-routes.ts` (`POST /iterate/remix`), `vetra-app/editors/vetra-studio/idea/startProduct.ts` (start from a package), `hooks/iterate-client.ts`

**Interfaces:**
- Consumes: Tasks 5.1, 5.2, 3.4 (`applyStudioEdit` pattern — remix uses its own change start because it may be a FIRST_BUILD), 0.3 `SET_ORIGIN`.
- Produces: `remixPackage(ctx, { packageName, version, slug }): Promise<{ changeId: string; missing: string[]; checks: { build: boolean; reducerTests: boolean; ownTests: boolean | null } }>`:
  1. `recoverSource` into a temp dir; refuse when `licenceAllowsRemix` is false.
  2. Copy into the workspace as reactor project dir `<slug>` (or the existing single project dir when the Studio already has one — then the change is a CHANGE "Add <pkg> to your product"): everything except `.git`, `node_modules`, `dist`, committed `*.tgz`, `.claude/`, submodules.
  3. Rename `package.json` `name` → the product package name (`productPackageName`), set `version` `0.0.0`, keep `license` and `LICENSE`/`NOTICE`/copyright headers untouched; align every `@powerhousedao/*`, `document-model`, `@renown/sdk` and `ph-cmd` dependency to the Studio's catalog version (R16 train, `ph-version.gen.ts`).
  4. Write `REMIX.md` (`remixMarkdown({ packageName, version, sourceUrl, ref, license, at, missing })`) and add `## Licence` text: `This product is a remix of <pkg> <version> (<license>). It keeps that licence and the original notices.`
  5. Git: commit `upstream/<pkg-safe>` branch with the pristine recovered tree first (for Task 5.5 merges), then the remix commit on `main`.
  6. Install + `ph generate` + build + the document models' generated reducer tests + the original's own tests when present; record as check runs.
  7. `SET_ORIGIN` (mode REMIX, missing list); one milestone `Remixed <pkg> <version>` with outcome `Your product starts as a copy of <name> — yours to change.`; each `missing` item as a milestone line `Couldn't bring over: <item>` (never silently dropped).
  8. Failing build/tests → studio note to the agent: `The remix of <pkg> doesn't build yet: <first reason>. Make it build without removing any of its parts.`
- `POST /iterate/remix { packageName, version }` → starts it in the background, `{ changeId }`; idea screen: `Remix` → `INIT_PRODUCT` (idea `Remix of <name>`) + route call; the story shows progress.
- [ ] **Step 1: Tests** (fixture: a tiny reactor project in a local git repo as the "upstream"): `remix keeps every model, editor and test`; `missing editor is listed, never dropped silently` (Review Focus 5); `package renamed, licence kept, REMIX.md written`; `powerhouse deps aligned to the Studio version`; `upstream branch holds the pristine source`; `non-remixable licence is refused`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): remix a published product into the workspace`.

### Task 5.4: Compose — use a package as is

**Files:** Create `vetra-cli/src/remix/compose.ts`, `vetra-cli/tests/remix/compose.test.ts`; Modify `iterate-routes.ts` (`POST /iterate/compose`)

**Interfaces:**
- Produces: `composePackage(ctx, { packageName, version }): Promise<{ changeId: string }>` — in the product's reactor project: `ph install --local <pkg>@<version>` (bundled into the one product package; ruling from spec designer's call); `SET_ORIGIN` mode COMPOSE; starts a CHANGE (agent turn) with request `Build on <name>: add your own documents that reference its documents by PHID. Keep <name> as it is.` so the agent designs the referencing models; milestone `Added <name> <version>`. Remix vs Compose is a customer choice; Compose is the only option when not remixable.
- [ ] **Step 1: Tests:** `installs into the product project and records the origin`; `starts a change for the agent with the build-on request`; `the product still publishes as one package` (publish-all fixture sees one project).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): compose with a published product`.

### Task 5.5: Upstream updates

**Files:** Create `vetra-cli/src/remix/upstream.ts`, `vetra-cli/tests/remix/upstream.test.ts`, `vetra-app/editors/vetra-studio/remix/UpstreamOffer.tsx`, `remix/UpstreamOffer.test.tsx`; Modify `iterate-routes.ts` (`POST /iterate/upstream/check`, `POST /iterate/upstream/bring-in`), `product/supervisor.ts` (daily check for live products), `shell/StudioShell.tsx` (offer under the strip)

**Interfaces:**
- Produces: `checkUpstream(ctx): Promise<{ packageName: string; latestVersion: string }[]>` — per origin: registry latest (dist-tag `latest`, else newest non-prerelease) ≠ `origin.version` → `SET_UPSTREAM_VERSION`; called on Studio open (browser → route, at most once per hour per browser) and daily from the supervisor when live; `bringInUpstream(ctx, packageName)`: REMIX → `recoverSource(latest)` onto the `upstream/<pkg>` branch as a new commit, then starts a CHANGE whose request is `Bring in <name> <ver> changes` and runs `git merge --no-ff upstream/<pkg>` in the workspace; conflicts → abort the merge, then hand the agent the request `Merge upstream/<pkg> into the product (git merge upstream/<pkg>) and resolve the conflicts, keeping the customer's changes.` within that change; clean merge → checks run as part of the change. COMPOSE → change `Update <name> to <ver>` that runs `ph install --local <pkg>@<ver>` then checks. `SET_ORIGIN` version updated when the change launches (orchestrator: after `completeLaunch`, origins whose upstream merge is in that version).
- `UpstreamOffer({ origin, onBringIn })` — `Bring in <name> <ver> changes` (button), shown when `latestVersion` is newer and no change is open.
- [ ] **Step 1: Tests:** `newer version sets the upstream version`; `same version does nothing`; `clean merge brings in the change`; `conflict hands the merge to the agent in the same change`; `compose update reinstalls the newer version`; offer component `shows only when a newer version exists and no change is open`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): bring in upstream changes`.

### Task 5.6: Going public with AGPL code

**Files:** Create `vetra-cli/src/remix/source-public.ts`, `vetra-cli/tests/remix/source-public.test.ts`, `vetra-app/editors/vetra-studio/remix/SourceNotice.tsx`, `remix/SourceNotice.test.tsx`; Modify `launch/orchestrator.ts` (gate + publish), `launch/publish-all.ts` (source in the tarball), `change/ReadyBar.tsx` + first-launch path (notice before Make it live)

**Interfaces:**
- Consumes: 0.3 `ACCEPT_SOURCE_NOTICE`, `SET_PUBLIC_SOURCE`, `origins`.
- Produces:
  - `needsPublicSource(state): { pkg: string; license: string } | null` — any origin (or any installed dependency of the product project) with an AGPL licence, and `access !== "OWNER_ONLY"`.
  - Notice (exact copy): `This product builds on <pkg> (AGPL). Going live makes its source public.` with buttons `Go live and publish the source` (→ `ACCEPT_SOURCE_NOTICE`, then the normal launch request) and `Not now`.
  - Orchestrator: launch refused with reason `the source notice wasn't accepted` (story/failure line `Accept the source notice to go live.`) when `needsPublicSource` and no `sourceNoticeAcceptedAt`; on launch (ruling P4-10: repositories are created private and no visibility API exists in the cloud, so P4 always uses the package route; `GITHUB` stays in the enum for later) the published product tarball includes the source (`files` adds `document-models`, `editors`, `apps`, `processors`, `subgraphs`, `REMIX.md`, `LICENSE`, `theme`) and `SET_PUBLIC_SOURCE {kind: PACKAGE, url: https://registry.vetra.io/<name>/-/<basename>-<version>.tgz}`.
  - The live product's `Source` link: rendered by the shared corner widget of `@vetra-apps/product-notes` (Task 8.1) when `publicSource` is set; until M8 lands the link is also written to the product's `README.md` and the manifest `publisher.url`. (Cut-line note: if M8 is cut, Task 8.1's corner widget is still built with only the Source link.)
- [ ] **Step 1: Tests:** `AGPL origin with signed-in access needs public source`; `owner-only access skips it`; `launch refused until the notice is accepted`; `the tarball carries the source and the public source is the tarball url`; `a connected GitHub repo does not change the public source (stays PACKAGE)`; notice component exact copy.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(remix): source goes public with AGPL products`.

### Task 5.7: M5 acceptance on staging

**Files (harness):** `phases/remix-phase.mjs`, `run.mjs`, `README-P4.md`.

- [ ] **Step 1:** Phase `remix` (G5) on a **fresh** P4 Studio (create + pin): idea screen → `Start from an existing product` → search `knowledge` → `@powerhousedao/knowledge-note` → `Remix` → story shows `Remixed …`; the change gets to READY (checks green; any `Couldn't bring over` lines recorded in the summary); `REMIX.md` exists (`/iterate/healthz`-style owner read via the workspace export, or chat tool `mastra_workspace_read_file`); product doc `origins[0]` mode REMIX licence `AGPL-3.0-only`; `Make it live` → source notice copy → accept → live; the public source URL answers 200. Compose path on a second fresh Studio (`REMIX_MODE=compose`, optional, `P4_STRICT` off): `Use as is` → change starts with the build-on request. Upstream: call `POST /iterate/upstream/check` and assert it answers (a newer real version is not guaranteed; record `latestVersion`; the merge paths are covered by Task 5.5's unit tests).
- [ ] **Step 2:** RR-p4, run → green. Commit `feat(p4): remix phase (G5)`; report M5.

---

## M6 — Two ways, side by side (G6)

Milestone start: merge `feat/studio-experience`.

### Task 6.1: Variant branches and two previews

**Files:** Create `vetra-cli/src/product/variants.ts`, `vetra-cli/tests/product/variants.test.ts`; Modify `vetra-cli/src/preview-server/resolver.ts` / `starter.ts` (a second preview from a worktree dir), `iterate-routes.ts` (`GET /iterate/variants/preview?label=`)

**Interfaces:**
- Consumes: `refs/vetra/change-base/<id>` (`git-versions.ts` `markChangeBase`), 0.3 variant ops.
- Produces (ruling P4-11: the agent always works in the main workspace; variants are built one after the other):
  - `beginVariant(ctx, changeId, label: "A"|"B")` — checks out `refs/heads/vetra/variants/<changeId>/<label>` created from the change base in the main workspace.
  - `finishVariant(ctx, changeId, label)` — commits the workspace onto that branch.
  - `startSecondPreview(ctx, changeId, label)` — `git worktree add .ph/vetra/variants/<changeId>-<label> <branch>` and starts its preview as a second service instance (ph-clint services default `maxInstances` 1 and the preview uses fixed ports 3000/4001 and proxy prefix `/reactor-project/vetra-studio/`): register a service `reactor-project-variant` in `cli.ts` beside the existing one with ports `3100`/`4101`, base `/reactor-project/vetra-variant/` and its own proxy route; only when free memory (cgroup `memory.max − memory.current`) ≥ `VARIANT_PREVIEW_MIN_FREE_MB = 900`; else returns `{ sideBySide: false }` and the switcher mode is used (stop/start one preview with the other branch checked out).
  - `keepVariant(ctx, changeId, label)` — main workspace to the kept branch's tree as one commit in the change (`Kept way <label>`), other branch moved to `refs/vetra/variants/<changeId>/<other>` (kept a day: `pruneVariantRefs(now)` deletes refs older than 24 h, run by the supervisor), worktree removed, second preview stopped; `KEEP_VARIANT`.
- [ ] **Step 1: Tests** (temp git repo): `both branches start from the change base`; `keep A leaves A's tree and parks B for a day`; `prune removes refs older than a day`; `low memory falls back to switching`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(variants): two ways on two branches`.

### Task 6.2: The agent builds two ways

**Files:** Create `vetra-cli/src/product/variant-run.ts`, `vetra-cli/tests/product/variant-run.test.ts`; Modify `product/supervisor.ts` (drives the sequence), `iterate-routes.ts` (`POST /iterate/variants { request }`), `vetra-app/editors/vetra-studio/change/startChange.ts` (phrase → variants route; ruling P4-17: the phrase is recognised by the Studio, `/\b(show me )?two ways\b/i` in the request text, not by the agent)

**Interfaces:**
- Produces: `runVariants(ctx, { changeId, request }): Promise<void>` — `START_VARIANTS`; A: `beginVariant` → agent message `Way A of two for: <request>. Build the most direct version.` → wait for the turn to finish and the change to have a passing check run → `finishVariant` → `SET_VARIANT_STATUS A READY` (+ summary = the turn's last reply's first sentence) or FAILED; B: same with `Way B of two for: <request>. Build a clearly different approach from way A (different layout or interaction), same scope.`; then `startSecondPreview`; each way is a separate agent turn in the change's chat; cost estimate (Task 6.3) is shown before this starts.
- [ ] **Step 1: Tests** (fake agent + fake git): `runs A then B with their instructions`; `a failed way is FAILED and the other still finishes`; `phrase in a request starts two ways`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(variants): the agent builds two ways`.

### Task 6.3: Side by side and keep one

**Files:** Create `vetra-app/editors/vetra-studio/variants/VariantsView.tsx`, `variants/VariantsView.test.tsx`, `variants/costEstimate.ts`, `variants/costEstimate.test.ts`; Modify `story/SteerBox.tsx` (button `Show me two ways` next to Send), `shell/StudioShell.tsx` (Review shows `VariantsView` when the open change has variants), `hooks/iterate-client.ts`

**Interfaces:**
- Produces: `estimateCostUsd(kind: "variants" | "review", ctx: { spentUsd: number; changes: number }): number` — average change cost = `spentUsd / max(1, launched or ready changes)` (fallback 0.60); variants = 2 × average; review = `REVIEW_COST_CAP_USD = 0.25`; `confirmCost(estimate)` shows `This builds two versions — about $<x.xx> of your budget.` with `Build both` / `Cancel` when > $0.50, else proceeds; `VariantsView({ variants, previews, onKeep(label) })` — two frames side by side with labels `Way A` / `Way B` and each summary, the same document open in both (same `doc` query), `Keep A` / `Keep B` (enabled when READY), switcher tabs when `sideBySide` is false.
- [ ] **Step 1: Tests:** `cost shown above 50 cents, skipped below`; `both ways side by side with the same document`; `switcher when side by side is not possible`; `Keep B calls the Studio and closes the view`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(variants): compare two ways and keep one`.

### Task 6.4: M6 acceptance on staging

- [ ] **Step 1:** Phase `variants` (G6): on Studio A (live product): `Show me two ways` with request `Show tags as coloured chips` → cost line (or not, recorded) → both ways READY → two frames visible (or switcher; record `sideBySide` and pod free memory) → `Keep B` → change READY with milestone `Kept way B`, preview shows B's look; refs parked.
- [ ] **Step 2:** RR-p4, run → green. Commit `feat(p4): variants phase (G6)`; report M6.

---

## M7 — The agent reviews itself (G7)

Milestone start: merge `feat/studio-experience`.

### Task 7.1: Review findings

**Files:** Create `vetra-cli/src/review/static-review.ts`, `vetra-cli/tests/review/static-review.test.ts`, `vetra-app/editors/vetra-studio/review/probes.ts`, `review/probes.test.ts`

**Interfaces:**
- Produces: `type Finding = { kind: "narrow" | "empty" | "a11y" | "contrast" | "colour" | "voice" | "flow"; where: string; detail: string; weight: number; screenshot?: string }` (shared shape, defined in vetra-app `review/finding.ts` and imported by vetra-cli);
  - `staticReview(projectPath, brand: BrandSheetState | null): Finding[]` — hard-coded colours in editor/app TSX (`bg-white|text-gray-\d+|#[0-9a-f]{3,8}|rgb\(` outside `theme/`), missing `data-vetra-component` on roots (weight 1), inputs/buttons without text or `aria-label`, labels containing a brand-sheet `voice.vocabulary.avoid` word.
  - `runProbes(frame: HTMLIFrameElement, opts): Promise<Finding[]>` (browser, same-origin preview): at 375 px width (hidden iframe clone of the preview URL) → horizontal overflow > 8 px = `narrow`; an empty new document of each editor's type, created in the Studio's preview drive and left there (nothing is ever deleted) rendering no text other than headings = `empty`; text contrast < 4.5 on visible text nodes (computed colours) = `contrast`; each with a `pointShot` screenshot uploaded as an attachment.
  - `rankFindings(findings): Finding[]` — by weight desc, max 3 distinct `kind`s first.
- [ ] **Step 1: Tests:** `flags hard-coded colours but not theme files`; `flags an avoided brand word in a label`; `flags an unlabeled icon button`; probes (happy-dom with fixed layout stubs) `reports horizontal overflow at 375 px`; `ranking keeps the three most important, one per kind first`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(review): find what to improve`.

### Task 7.2: The review pass after every version

**Files:** Create `vetra-cli/src/review/review-pass.ts`, `vetra-cli/tests/review/review-pass.test.ts`; Modify `launch/orchestrator.ts` (after `completeLaunch` and the idea suggestions), `iterate-routes.ts` (`POST /iterate/review/findings`, `POST /iterate/review/run`), `commands/product/progress.ts` (action `review` with `items[{text, screenshot?}]` → `SET_REVIEW_SUGGESTIONS`), `vetra-app/editors/vetra-studio/review/useReviewProbes.ts`, `shell/StudioShell.tsx`

**Interfaces:**
- Produces: `reviewPass(ctx, version: number): Promise<"done" | "skipped-budget" | "no-findings">` — skipped when the budget level is low/exhausted (`chatBudgetUsedUp` + usage ratio ≥ 0.8); collects `staticReview` + browser findings posted to `/iterate/review/findings` within `REVIEW_PROBE_WAIT_MS = 60_000` (the Studio page posts them when it is open after the launch; `useReviewProbes` runs on `liveVersion` change); when no findings → `no-findings`; else one bounded agent turn (`maxSteps 6`, cost cap `REVIEW_COST_CAP_USD`) with the message `Review of Version <n>: turn these findings into at most 3 suggestions the customer can apply with one click (product-progress action "review"). Most important first. <findings JSON>`; `Review it` on demand → `POST /iterate/review/run`.
- [ ] **Step 1: Tests:** `runs after a launch and asks for review suggestions`; `skipped when the budget is low`; `no findings → no agent turn`; `waits for browser probes up to a minute`; progress `review action stores REVIEW suggestions (max 3)`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(review): self-review after every version`.

### Task 7.3: Review suggestions in the Studio

**Files:** Modify `change/SuggestionsCard.tsx` (+ test), `change/changeHistory.ts` (`openSuggestions`), `change/startChange.ts` (unchanged USE_SUGGESTION path), `story/StoryPane.tsx` (`Review it` action in the menu)

**Interfaces:**
- Produces: suggestions sorted REVIEW first then IDEA, at most 3 shown; REVIEW items show a small label `From the review` and the screenshot thumbnail (click to enlarge); `Apply` (REVIEW) / existing pick (IDEA) both go through `USE_SUGGESTION` → a change; `Review it` button (live product, no open change) → `POST /iterate/review/run`, cost line when > $0.50 (never for the capped pass).
- [ ] **Step 1: Tests:** `review suggestions come first and at most three show`; `Apply starts a change from the review suggestion`; `Review it asks the Studio to run a review`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(review): apply review suggestions in one click`.

### Task 7.4: M7 acceptance on staging

- [ ] **Step 1:** Phase `review` (G7): after a launch on Studio A (Studio page open), within 5 min the product doc has 1–3 REVIEW suggestions for the live version; the card shows them first with `From the review`; `Apply` on one → a change starts with that text; budget-low path tested by unit tests only (recorded).
- [ ] **Step 2:** RR-p4, run → green. Commit `feat(p4): review phase (G7)`; report M7.

---

## M8 — Notes from the live product (G8)

Milestone start: merge `feat/studio-experience`.

### Task 8.1: The shared notes package

**Files:** Create `packages/product-notes/` (a reactor project: `package.json` name `@vetra-apps/product-notes` version `0.1.0`, `powerhouse.config.json`, `document-models/product-note/` via codegen, `editors/` none, `src/corner/` widget, tests); Modify `pnpm-workspace.yaml`

**Interfaces:**
- Produces: document model `vetra/product-note` (extension `.vpn`, name `Product Note`), state `ProductNoteState { text: String screen: String documentType: String documentId: PHID sender: String createdAt: DateTime status: NoteStatus! }` with `enum NoteStatus { OPEN USED DISMISSED }`; ops `CREATE_NOTE { text: String!, screen: String!, documentType: String, documentId: PHID, sender: String!, createdAt: DateTime! }` (errors `NoteExistsError` if text already set, `InvalidNoteTextError` empty or > 1000 chars), `SET_NOTE_STATUS { status: NoteStatus! }`; reducer coverage ≥ 95%.
- Corner widget (ruling P4-12, resolved from research on how a package can show UI next to editors): `mountProductCorner(opts: { notesEnabled: boolean; sourceUrl: string | null })` — a fixed bottom-right element mounted once into `document.body` by the package entry's side effect, showing `Send a note` (when enabled) and `Source` (when a public source is set); reads the selected drive/document/screen from the reactor-browser globals; `Send a note` → textarea (placeholder `What should <name> know?`) → `Send` creates a `vetra/product-note` document in the product drive with the sender's Renown address; per-sender daily cap `NOTES_PER_SENDER_PER_DAY = 5` checked against the sender's notes in the drive (client-side; the Studio inbox also hides notes over the cap — ruling P4-13); signed-out visitors see `Sign in to send a note`. Connect imports every installed package's `browser/index.js` (`BrowserPackageManager.#importPackage`), so module side effects run; reactor-browser exposes `window.ph` (`getPHStore`, `subscribeToPHValue`, events `ph:selectedDriveIdUpdated` / `ph:selectedNodeIdUpdated`), `dispatchActions` and `addDocument(driveId, name, documentType, …)`. Configuration (ruling P4-14): `vetra-product.json` (`{ name, notesEnabled, sourceUrl }`) is written into the **product** package at publish time (not committed; part of the published version) and the widget finds it from Connect's installed-package list (`<cdnUrl>/<product>/vetra-product.json`); the implementer records the exact discovery API in the report.
- [ ] **Step 1: Tests:** reducer tests incl. every error; widget `shows Send a note only when enabled`; `sixth note in a day is refused with Try again tomorrow.`; `Source link opens the public source`; `signed out asks to sign in`.
- [ ] **Step 2:** FAIL → implement → PASS; build the package (`ph build`). Commit `feat(notes): shared notes package`.

### Task 8.2: Launch with notes

**Files:** Modify `vetra-cli/src/launch/publish-all.ts` / `orchestrator.ts` (adds `@vetra-apps/product-notes@<version>` to `LaunchInput.packages` when notes are enabled or a public source exists; writes `vetra-product.json`), `vetra-cli/src/launch/compat-rollback.ts` (ignores the notes package in the data-compatibility gate), `vetra-app/editors/vetra-studio/settings/SettingsDialog.tsx` (+ test) (toggle `Let people using <name> send you notes`), release workflow (publish `packages/product-notes` to registry.vetra.io with the same channel; `launchStudioVersion` already accepts any `@vetra-apps/*` package).

**Interfaces:**
- Consumes: 0.3 `SET_NOTES_ENABLED`, Task 8.1 package.
- Produces: `launchPackages(state, productPackages): PackageVersion[]` — adds the notes package when notes are on **or** `publicSource` is set (the corner also carries the Source link); the Version's `packages` keeps listing only product packages (Go back / compat untouched); toggling notes is itself a launch request (ruling P4-14: `Turn notes on` → a launch of the live version's code with the notes package and `vetra-product.json`, which makes a new version; story line `Notes from people using <name> are on.`).
- [ ] **Step 1: Tests:** `notes on adds the notes package to the launch`; `version packages stay the product's only`; `rollback compatibility ignores the notes package`; settings toggle `dispatches SET_NOTES_ENABLED and asks to relaunch`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(notes): launch the notes corner with the product`.

### Task 8.3: The notes inbox

**Files:** Create `vetra-cli/src/notes/notes-inbox.ts`, `vetra-cli/tests/notes/notes-inbox.test.ts`, `vetra-app/editors/vetra-studio/notes/NotesInbox.tsx`, `notes/NotesInbox.test.tsx`; Modify `iterate-routes.ts` (`GET /iterate/notes`, `POST /iterate/notes/status`), `strip/StepStrip.tsx` (`<n> notes` chip), `change/ChangeDrawer.tsx` (prefill)

**Interfaces:**
- Consumes: `createDriveClient` (`launch/product-drive.ts`, owner-delegated identity).
- Produces: `listNotes(ctx): Promise<Note[]>` (OPEN notes in the product drive, newest first, over-cap senders hidden); `setNoteStatus(ctx, id, status)`; `NotesInbox({ notes, onTurnIntoChange(note), onDismiss(note) })` — each note: text, screen, when, sender (short address, owner only), `Turn into a change` (opens the change drawer prefilled `<text>\n\n[From a note on <screen>]` and on send marks the note USED) and `Dismiss` (DISMISSED); chip `1 note` / `<n> notes`; polled every 60 s while live.
- [ ] **Step 1: Tests:** `lists open notes newest first`; `hides notes over the per-sender cap`; `Turn into a change prefills and marks it used`; `Dismiss marks it dismissed`; chip pluralisation.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(notes): notes inbox in the Studio`.

### Task 8.4: M8 acceptance on staging

- [ ] **Step 1:** Phase `notes` (G8): Settings → toggle notes on → relaunch done; a second browser (throwaway signed-in identity) opens the live product → `Send a note` → `Please add a due date` → within 2 min the Studio strip shows `1 note` with the screen → `Turn into a change` → drawer prefilled → Send → change starts; note USED; `Source` link present when the product is a remix.
- [ ] **Step 2:** RR-p4 (+ product-notes publish), run → green. Commit `feat(p4): notes phase (G8)`; report M8.

---

## M9 — Demo

Milestone start: merge `feat/studio-experience`.

### Task 9.1: The demo script as one phase

**Files (harness):** `phases/demo-phase.mjs`, `run.mjs`, `README-P4.md`

- [ ] **Step 1:** Phase `demo` (spec §2 acceptance) on a fresh P4 Studio pinned to the newest p4 build: Remix knowledge-note → Point at a note card → `add tags` → `Show me two ways` → keep one → Theme `Bolder` → Keep → Make it live (accept the source notice) → a note from the live product arrives (second browser) → apply one self-review suggestion → Go back to the previous version works (live version moves back, data intact). After each change: Activity ≤ 12 lines (`storyLineCount`). Record durations per step and total cost.
- [ ] **Step 2:** Run → green (fix forward via normal tasks if red). Commit `feat(p4): demo phase`.

### Task 9.2: Final staging run and report

- [ ] **Step 1:** RR-p4 final build; run phases `story,layout,point,theme,remix,variants,review,notes,demo` on fresh Studios; all green; collect `summary.json` paths and screenshots in the ledger.
- [ ] **Step 2:** Final whole-branch review (SDD), fixes, ledger rulings list. No PR to main; report.
