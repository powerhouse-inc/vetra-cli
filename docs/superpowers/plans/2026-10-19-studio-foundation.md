# Vetra Studio Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Studio build never dead-ends: deploy is accepted, chats survive provider/budget/restart failures, cost is bounded and visible, GitHub errors are actionable, and the website is honest.

**Architecture:** Fix the shared chat framework (ph-clint) first — 6.2.3 compatibility plus turn-level errors, retries, pickup receipts and a resumable session — release it, then move the Studio (vetra-cli + vetra-app) to Powerhouse 6.2.3 and the new ph-clint with output caps, default fallbacks, a smaller context and a budget surface. The cloud backend gains per-Studio budget overrides, a budget-request path, fallback env injection, mapped GitHub errors and a self-cleaning health worker. Live-only defects (sync Forbidden, `[object Object]`, GitHub root cause) are investigated on staging once the new pieces run there. Rollout is staging first, then prod.

**Tech Stack:** TypeScript, React (Connect editors), Mastra agents, `@openrouter/ai-sdk-provider` 1.5.4, Powerhouse 6.2.3 (reactor, renown, document-model), Kysely/Postgres, GraphQL (Apollo subgraphs), vitest/jest, Kubernetes/ArgoCD.

**Spec:** `docs/superpowers/specs/2026-10-19-studio-foundation-design.md` (this repo). Research notes the facts below come from: the spec's Evidence section.

## Workspaces

| Repo | Worktree | Branch | Base |
|---|---|---|---|
| ph-clint | `/home/f/projects/ph-clint-foundation` | `feat/foundation-chat` | `origin/main` (fetch first; local main is behind) |
| vetra-cli (Studio) | `/home/f/projects/vetra-cli-foundation` | `feat/studio-foundation` | `origin/main` (exists) |
| vetra-cloud-package | `/home/f/projects/vetra-cloud-package-foundation` | `feat/foundation` | `origin/main` |
| vetra.io | `/home/f/projects/vetra.io-foundation` | `feat/foundation` | `origin/staging` (== main) |
| powerhouse-k8s-hosting | `/home/f/projects/powerhouse-k8s-hosting` | `main` (direct, config-only) | — |

## Global Constraints

- Staging first, then prod, for every service and image; pin image tags only after the image exists.
- Commits/PRs: conventional messages; **no `Co-Authored-By` or "Generated with" trailers**; public repos use neutral wording (no security language).
- Pushes that touch `.github/workflows` go over SSH (`git push git@github.com:<org>/<repo>.git HEAD:<branch>`); never `gh auth refresh`.
- No secrets in output, logs, commits or test fixtures.
- Existing Studios and their data survive every change: document-model changes add operations to `chat-session` v1 (model versioning is not implemented in ph-clint), never remove or reshape existing fields.
- Powerhouse target for the Studio: **6.2.3** (all `@powerhousedao/*`, `document-model`, `@renown/sdk`, `ph-cmd`); prod switchboard/connect → `v6.2.3`; staging switchboard stays on its line (`v6.2.3-dev.45`; migrations are forward-only).
- Output caps: main agent **8192**, sub-agents **16384**, memory model **4096** output tokens.
- Default fallback chain (when `VETRA_MODEL_FALLBACKS` is unset): `deepseek/deepseek-v4.1-flash`, `google/gemini-3.1-flash-lite` (the configured primary is never repeated).
- Automatic retries per turn: **3**, backoff as today (`retry-after` else full jitter, cap 30 s).
- Budgets: staging default **$10**/Studio/month; demo Studio `vivid-slug` gets an explicit **$50**; prod default stays **$1**.
- Budget warning threshold: **80%** of the limit.
- Prod logs at `warn`; every unexpected error in Studio-facing resolvers is logged at `error` with context (no secrets).
- vetra.io changes go to **both `main` and `staging`**.
- Alert routing is out of scope (Frank, 2026-10-19).

## Review Focus

1. A provider error arrives **before any text** of a turn → it is retried like any other retryable error, never left as a stuck spinner. (Task 3: `retries a retryable error that arrives before any text`.)
2. A turn fails **after a tool call already ran** → the retry continues from memory and does not re-run the completed tool. (Task 3: `retry after a completed tool call does not re-run it`.)
3. The agent process dies mid-turn (OOM/restart) → on startup the turn is marked failed with Retry, or retried once automatically; never "in progress" forever. (Task 3: `startup reconcile fails or retries an unfinished turn`.)
4. Budget fully spent while the customer types → the failure shows the budget state and "Request more budget", not a generic error, and the session stays usable. (Task 4 + Task 9 tests.)
5. An existing `ERROR` session from before the upgrade → it can be resumed with all messages and usage intact. (Task 2: `RESUME_SESSION keeps messages and usage`.)

---

## Phase A — ph-clint (chat framework)

### Task 1: ph-clint runs on Powerhouse 6.2.3

**Files:**
- Modify: `packages/ph-clint/src/integrations/powerhouse/reactor.ts:99-139` (reactor builder), `packages/ph-clint/src/integrations/powerhouse/drive.ts:59-60` (fixed-id drive), `packages/ph-clint/src/integrations/powerhouse/folders.ts:200`
- Modify: ph-clint workspace Powerhouse dev/peer versions → `6.2.3` (keep peer range `>=6.2.0-dev.0`)
- Test: `packages/ph-clint/tests/powerhouse-reactor-623.test.ts` (new)

**Interfaces:**
- Produces: the embedded reactor can create a drive with a fixed id and write folder/chat-session documents under 6.2.3 without a Renown identity.

The embedded reactor is local and private: build it with `withCreateSignaturePolicy("legacy")` so locally created documents accept unsigned writes, and create the fixed-id drive with a presigned/derived header instead of mutating `header.id` after `createDocument()` (6.2.3 rejects that with `ID_MISMATCH`).

- [ ] **Step 1: Write the failing tests** — `creates the agent drive with a fixed id on 6.2.3` (drive id equals the requested id, no `ID_MISMATCH`), `writes folders and a chat-session unsigned on the embedded reactor` (no `UNSIGNED_REQUIRED`).
- [ ] **Step 2:** Bump Powerhouse to 6.2.3 in the ph-clint workspace; `pnpm install`; run the tests → FAIL with `ID_MISMATCH` / `UNSIGNED_REQUIRED`.
- [ ] **Step 3:** Implement the reactor policy and fixed-id drive creation as above.
- [ ] **Step 4:** `pnpm -r run build && pnpm --filter ph-clint test` → new tests PASS, no new failures (record pre-existing failures before Step 2).
- [ ] **Step 5:** Commit `fix(ph-clint): run the embedded reactor on Powerhouse 6.2.3`.

### Task 2: chat-session operations for turn-level errors, pickup and resume

**Files:**
- Modify (via reactor-mcp ADD_OPERATION / SET_OPERATION_SCHEMA / SET_OPERATION_REDUCER, then `ph-cli generate`, per `packages/clint-common/CLAUDE.md`): `packages/clint-common/document-models/chat-session/v1/schema.graphql`, `chat-session.json`, `v1/src/reducers/{system,user,agent}.ts`
- Modify: `editors/chat-session-editor/components/test-pane/operations.ts`, `v1/src/utils.ts` (`hasMessageContent`)
- Test: `v1/tests/{system,user,agent}.test.ts`

**Interfaces (all additive to v1):**
- State: `Message.pickedUpAt: DateTime` (USER messages); `Message.failure: TurnFailure` with `TurnFailure { code: String!, message: String!, retryable: Boolean!, failedAt: DateTime! }`; `ChatSessionState.retryRequestedFor: OID` (user message id or null).
- Ops: `MARK_MESSAGE_PICKED_UP { messageId: OID!, pickedUpAt: DateTime! }` (agent) · `FAIL_TURN { id: OID!, userMessageId: OID!, code: String!, message: String!, retryable: Boolean!, failedAt: DateTime! }` (agent: appends a finished ASSISTANT message with an ERROR part and `failure`, `finishedAt = failedAt`, `finishReason = "error"`) · `RETRY_TURN { userMessageId: OID! }` (user: sets `retryRequestedFor`) · `CLEAR_RETRY_REQUEST { _: Boolean }` (agent) · `RESUME_SESSION { resumedAt: DateTime! }` (user: `ERROR` → `ACTIVE`, keeps messages/usage, clears `endedAt`).
- Errors: `MessageNotFoundError` (pickup/retry on unknown id), `SessionNotResumableError` (RESUME_SESSION when not `ERROR`).

- [ ] **Step 1: Write failing reducer tests:** `MARK_MESSAGE_PICKED_UP sets pickedUpAt on the user message`; `FAIL_TURN appends a finished error message and keeps status ACTIVE`; `RETRY_TURN sets retryRequestedFor`; `RESUME_SESSION keeps messages and usage` (state with 3 messages and usage totals → status ACTIVE, same messages, same usage, `endedAt` null); error tests for both error codes using the operation-index pattern (no `.toThrow()`).
- [ ] **Step 2:** Run `pnpm --filter @powerhousedao/clint-common test` → FAIL.
- [ ] **Step 3:** Add the operations through reactor-mcp, regenerate, implement reducers in `src/reducers/*`.
- [ ] **Step 4:** `pnpm --filter @powerhousedao/clint-common test:coverage` → PASS, reducers ≥ 95% lines/branches.
- [ ] **Step 5:** Commit `feat(clint-common): chat turns can fail, be retried and picked up; ERROR sessions can resume`.

### Task 3: chat-bridge and watcher — retry anywhere, never end the session, resume after restart

**Files:**
- Modify: `packages/clint-common/chat/chat-bridge.ts:159-410`, `packages/clint-common/chat/chat-session-watch.ts:28-323`, `packages/ph-clint/src/integrations/mastra/stream.ts:112-132` (classification unchanged except as needed)
- Test: `packages/clint-common/chat/chat-bridge.test.ts`, `packages/clint-common/chat/chat-session-watch.test.ts` (new; fake reactor client + fake stream)

**Interfaces:**
- Consumes: Task 2 ops.
- Produces: `writeAgentStreamToDocument(stream, opts)` never dispatches `END_SESSION`; on a non-retryable error it dispatches `FAIL_TURN`; on a retryable error it throws `RetryableStreamError` regardless of how much was written. The watcher dispatches `MARK_MESSAGE_PICKED_UP` before streaming, retries up to 3 times by re-running the turn with a continue prompt (Mastra memory holds the completed steps), then `FAIL_TURN { retryable: true }`; it runs a turn when `retryRequestedFor` is set (then `CLEAR_RETRY_REQUEST`); token totals from `finish`/`step-finish` usage go into `UPDATE_USAGE_SUMMARY`.
- Continue prompt (exact copy): `The previous response was interrupted by a temporary provider error. Continue exactly where you stopped; do not repeat tool calls that already completed.`

- [ ] **Step 1: Write failing tests:** `retries a retryable error that arrives before any text`; `retries a retryable error after text and tool calls`; `retry after a completed tool call does not re-run it` (fake agent asserts the retried call receives the continue prompt and the tool runs once); `non-retryable error fails the turn and keeps the session ACTIVE` (no END_SESSION, a FAIL_TURN with `retryable:false`, input usable); `exhausted retries fail the turn as retryable`; `marks the user message picked up before streaming`; `runs a turn when retryRequestedFor is set and clears it`; `startup reconcile fails or retries an unfinished turn` (last message ASSISTANT without `finishedAt` → one automatic retry, then FAIL_TURN); `records token usage totals`.
- [ ] **Step 2:** Run the clint-common tests → FAIL.
- [ ] **Step 3:** Implement. The budget/credit refusal (OpenRouter 402, or message containing `requires more credits`) maps to `code: "BUDGET_EXHAUSTED"`, `retryable: false`.
- [ ] **Step 4:** Tests PASS; `pnpm -r run build` clean.
- [ ] **Step 5:** Commit `feat(clint-common): turns retry anywhere and fail without ending the session`.

### Task 4: chat editor — Retry, Resume, delivery state, budget action slot

**Files:**
- Modify: `packages/clint-common/editors/chat-session-editor/ChatSession.tsx:37-53,125`, `components/ChatInputBar.tsx:138-209`, `components/ContentPartRenderer.tsx:100,254-262`, `components/MessageBubble.tsx`, `components/SessionStatusBar.tsx:30,64-72`
- Test: `editors/chat-session-editor/__tests__/chat-session-states.test.tsx` (new)

**Interfaces:**
- Produces: a failed turn shows its message and a **Retry** button (dispatches `RETRY_TURN`); `ERROR` sessions show **Resume** (dispatches `RESUME_SESSION`); the input is enabled whenever the session is `ACTIVE`; user messages show `sent` → `delivered` (present in synced state) → `picked up` (`pickedUpAt`), and after **60 s** without pickup show "Not picked up yet" with Retry; a failure with `code: "BUDGET_EXHAUSTED"` renders the host-provided action from an optional editor prop `renderFailureAction?: (failure: TurnFailure) => ReactNode` (vetra-app passes "Request more budget"). `responding` is false once a FAIL_TURN message exists after the last user message (no stuck spinner).

- [ ] **Step 1: Write failing tests:** `shows Retry on a failed turn and dispatches RETRY_TURN`; `shows Resume on an ERROR session and dispatches RESUME_SESSION`; `input enabled after a failed turn`; `shows picked up when pickedUpAt is set`; `shows not picked up after 60s`; `renders the host failure action for BUDGET_EXHAUSTED`; `no spinner after FAIL_TURN`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS (`pnpm --filter @powerhousedao/clint-common test`).
- [ ] **Step 5:** Commit `feat(clint-common): retry, resume and delivery state in the chat editor`.

### Task 5: release ph-clint

**Files:** none beyond version bumps produced by the publish tooling.

- [ ] **Step 1:** Open a PR `feat/foundation-chat` → `main` in powerhouse-inc/ph-clint with Tasks 1–4; wait for checks; merge.
- [ ] **Step 2:** Run the release workflow on `main` (`gh workflow run release.yml -R powerhouse-inc/ph-clint --ref main`) → dev versions `0.1.0-dev.N` of ph-clint, clint-common, ph-clint-dev, ph-clint-observability.
- [ ] **Step 3:** Verify: `npm view @powerhousedao/clint-common@<version> version --registry https://registry.npmjs.org` (and ph-clint) → the new version. Record it in the ledger for Task 6.

## Phase B — Studio (vetra-cli + vetra-app)

### Task 6: Studio on Powerhouse 6.2.3 and the new ph-clint, signing v2

**Files:**
- Modify: `pnpm-workspace.yaml:8-31` (catalog → 6.2.3), `:34-37` (ph-clint packages → Task 5 version), `:67-72` (cloud-package overrides → 6.2.3), `vetra-cli/src/ph-version.gen.ts` (regenerate via `pnpm --filter vetra build:assets`)
- Modify: any compile errors from `ISigner.signAction(action, target, signal)` (no custom signers exist; fix call sites only)
- Test: `vetra-cli/tests/cloud/signing-v2.test.ts` (new)

**Interfaces:**
- Produces: every Renown-signed action the Studio pushes carries a v2 tuple; new customer projects scaffold on 6.2.3 (`DEFAULT_PH_VERSION = '6.2.3'`); existing projects are untouched.

- [ ] **Step 1: Write the failing test** `Renown signer produces a v2 tuple the shared verifier accepts as v2-required`: sign a `SET_LABEL` action for a fake env id with the vetra-cli Renown signer, verify with `verifyActionSignature` (policy `v2-required`) → `{ ok: true, scheme: "v2" }`.
- [ ] **Step 2:** Run `pnpm --filter vetra test -- signing-v2` → FAIL on 6.2.1.
- [ ] **Step 3:** Bump catalog/overrides/ph-clint, `pnpm install`, regenerate `ph-version.gen.ts`, fix compile errors.
- [ ] **Step 4:** `pnpm -r typecheck && pnpm --filter vetra test && pnpm --filter vetra-app test` → PASS (only the documented pre-existing failures remain; record them before Step 3). `pnpm build` succeeds.
- [ ] **Step 5:** Commit `feat(studio): Powerhouse 6.2.3 — v2 signatures the cloud accepts`.

### Task 7: output caps, default fallbacks, fewer steps

**Files:**
- Modify: `vetra-cli/src/agents/llm.ts:19,47,70-119` (`make(modelId, fallbacks, maxOutputTokens)`), `vetra-cli/src/agents/agent.ts:198-205,275` (`maxSteps` 80 → **40**; TokenLimiter input cap → **64000** tokens), `vetra-cli/src/framework.ts:51-54` (default fallbacks)
- Test: `vetra-cli/tests/agents/llm.test.ts`

**Interfaces:**
- Produces: `createLlmModels(s, opts)` returns models whose requests carry `max_tokens` 8192 (main) / 16384 (subagent) / 4096 (memory); `resolveFallbacks(primary: string, configured: string[] | undefined): string[]` returns the configured list or the default chain minus the primary, capped at `MAX_FALLBACKS`; memory model also gets fallbacks.

- [ ] **Step 1: Write failing tests:** `main requests send max_tokens 8192`, `subagent requests send max_tokens 16384`, `memory requests send max_tokens 4096`, `default fallbacks are used when none are configured and never repeat the primary`, `configured fallbacks win`.
- [ ] **Step 2–4:** Run → FAIL; implement (cap via `extraBody.max_tokens`, which the provider merges last); run → PASS.
- [ ] **Step 5:** Commit `feat(agent): cap output tokens, default fallback models, 40 steps, 64k context`.

### Task 8: measured context reduction

**Files:**
- Create: `vetra-cli/scripts/measure-turn-tokens.ts` (runs one scripted build prompt through the agent against a staging key, sums per-step `inputTokens`/`cachedInputTokens`/`outputTokens` from stream usage, prints totals and per-step mean as JSON)
- Modify: `vetra-cli/src/cli.ts:94-117` (main agent instructions: load `workflow.md` and skill bodies per phase on demand instead of always), prompt files under `vetra-cli/prompts/agent-profiles/*` only to remove duplication
- Test: `vetra-cli/tests/agents/instructions-size.test.ts` (always-loaded main instructions ≤ **8 KB**)

- [ ] **Step 1:** Record the baseline with the script on staging (same prompt: `Build a todo list app with a title, due date and done flag; editor with add, complete and delete`) → save JSON to the ledger.
- [ ] **Step 2: Write the failing test** `always-loaded main instructions are at most 8 KB` → FAIL (≈13.7 KB today).
- [ ] **Step 3:** Move phase-specific instructions behind the existing skill/workspace loading; keep behaviour.
- [ ] **Step 4:** Test PASS; re-run the measurement → per-step mean input tokens **≤ 50%** of baseline; agent still completes the build (preview shows the editor). If < 50% reduction, record what remains and continue — the reduction is measured, not assumed.
- [ ] **Step 5:** Commit `perf(agent): load phase instructions on demand (per-step context −X%)` with the measured number.

### Task 9: budget meter, out-of-budget state, "Request more budget" (Studio UI)

**Files:**
- Create: `vetra-app/editors/vetra-studio/budget/budgetClient.ts` (`fetchStudioLlmUsage(envId, token)`, `requestMoreBudget(envId, token)` using the `deploy/githubConnect.ts:72-98` `gql()` pattern and `resolveCloudGraphqlEndpoint()`), `budget/BudgetMeter.tsx`, `budget/useStudioBudget.ts` (poll 60 s)
- Modify: `vetra-app/editors/vetra-studio/VetraStudio.tsx:583-614` (meter in the top bar), chat editor wiring to pass `renderFailureAction`
- Test: `vetra-app/editors/vetra-studio/budget/budget.test.tsx`

**Interfaces:**
- Consumes: cloud `vetraLlm.studioLlmUsage { source model usageUsd limitUsd resetsAt }`, Task 11 `vetraLlm.requestStudioLlmBudget(environmentId)`; Task 4 `renderFailureAction`.
- Produces: top bar shows `$used of $limit`; ≥ 80% shows a warning state; at 100% (or a `BUDGET_EXHAUSTED` failure) shows "Budget used up" with **Request more budget**; after requesting it shows "Requested — we'll raise it soon" and doesn't allow a second request within 24 h.

- [ ] **Step 1: Write failing tests:** `shows used of limit`, `warns at 80 percent`, `shows request button when exhausted`, `request calls the mutation once and shows requested`, `chat failure action renders request for BUDGET_EXHAUSTED`.
- [ ] **Step 2–4:** Run (`pnpm --filter vetra-app test`) → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `feat(studio): visible budget and a way to ask for more`.

### Task 10: release the Studio agent to the staging pool

- [ ] **Step 1:** PR `feat/studio-foundation` → `main` (vetra-cli repo); checks green; merge.
- [ ] **Step 2:** Bump `vetra-cli`/`vetra-app` to the next `0.0.8-dev.N`, run `gh workflow run release.yml -R powerhouse-inc/vetra-cli --ref main`; rerun failed publish steps if a registry upload 409s/504s (known); verify both tarballs exist on both registries (HEAD 200).
- [ ] **Step 3:** Wait for clint-image-builder to build `clint-agent/vetra:<version>` automatically (job `build-vetra-<version>` completes).
- [ ] **Step 4:** Staging pin `STUDIO_POOL_VERSION` (k8s `tenants/staging/powerhouse-values.yaml`) → new version; a warm Studio boots Ready, 0 restarts.

## Phase C — Cloud backend (vetra-cloud-package)

### Task 11: per-Studio budget override, budget requests, fallback env

**Files:**
- Modify: `subgraphs/vetra-llm/db/migrations.ts`, `db/schema.ts` (tables `studio_llm_budget_overrides(environment_id PK, limit_usd, set_by, updated_at)` and `studio_llm_budget_requests(id PK, environment_id, requested_by, requested_at, handled_at)`), `schema.ts:48` (mutations), `resolvers.ts:183,241-257`, `broker.ts:198-207,322,362-381`, `sweeper.ts:108-109`, `config.ts:24-33` (`VETRA_LLM_FALLBACK_MODELS`), `subgraphs/vetra-studio-pool/claim.ts:157-169`
- Test: `subgraphs/vetra-llm/__tests__/{budget-override,budget-request,fallback-env}.test.ts`

**Interfaces:**
- Produces: `vetraLlm.requestStudioLlmBudget(environmentId: String!): Boolean!` (operator of the Studio; at most one open request per Studio per 24 h; logs `[vetra-llm] budget request <envId> by <address>` at **error** level so it is visible at prod's warn level); `vetraLlm.setStudioLlmBudget(environmentId: String!, limitUsd: Float!): StudioLlmUsage!` (admins only; writes the override, updates the OpenRouter key limit immediately, marks open requests handled); `budgetForDid`/broker/sweeper honour the override before invite-code/default budgets; the broker and the warm-pool claim write `VETRA_MODEL_FALLBACKS` from `VETRA_LLM_FALLBACK_MODELS` alongside `VETRA_MODEL` (add it to the claim `entries` so `replaceTenantConfig` keeps it).

- [ ] **Step 1: Write failing tests:** `override wins over invite-code and default budgets`; `setStudioLlmBudget updates the key limit and handles open requests`; `setStudioLlmBudget is admin-only`; `requestStudioLlmBudget records one request per 24h and requires an operator`; `claim and broker write VETRA_MODEL_FALLBACKS`; migrations test covers the two tables.
- [ ] **Step 2–4:** Run `pnpm vitest run subgraphs/vetra-llm subgraphs/vetra-studio-pool` → FAIL; implement; → PASS; full `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Commit `feat(llm): per-Studio budget overrides, budget requests, fallback models for Studios`.

### Task 12: actionable GitHub errors and complete rollback

**Files:**
- Modify: `subgraphs/vetra-apps/github.ts:162-169,400-425`, `service.ts:855-1058,1362-1404`, `resolvers.ts:63-76`, `errors.ts:3-16`; `subgraphs/vetra-github-auth/github-app.ts:176-186`, `resolvers.ts:268-279`; Studio map `vetra-cli-foundation/vetra-app/editors/vetra-studio/deploy/githubConnect.ts:56-64` (new codes)
- Test: `subgraphs/vetra-apps/__tests__/studio-apps-errors.test.ts`, `subgraphs/vetra-github-auth/__tests__/errors.test.ts`

**Interfaces:**
- Produces error codes: `REPO_NAME_INVALID` (422 validation other than "already exists"), `REPO_EXISTS`, `INSUFFICIENT_PERMISSION` (403/404, incl. installation and Administration permission), `ORG_POLICY` (422/403 mentioning org policy), `GITHUB_NOT_CONNECTED` (401), `GITHUB_UNAVAILABLE` (5xx/timeouts), `DEPLOY_SETUP_FAILED` (Harbor/Renown/env steps), each with a customer-readable message and next step; `guard()` logs unexpected errors at **error** level with step name; `undoFailedCreate` also deletes the env document created at step 8.

- [ ] **Step 1: Write failing tests:** one per code (fake GitHub responses: 422 `name already exists`, 422 `name is invalid`, 403, 404, 401, 502; Harbor failure; env-create failure); `rollback deletes the production env document`; `422 invalid name is not reported as already exists` (github-auth).
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `fix(apps): actionable GitHub and setup errors; roll back the production environment too`.

### Task 13: health — stop polling dead environments, log what matters

**Files:**
- Modify: `subgraphs/vetra-cloud-observability/clint-pull-worker.ts:53,67-72,300-370`, `processors/vetra-cloud-environment/cleanup.ts:46-59` (reuse `removeEnvironmentRecord`), environment processor/watcher where `DEPLOYMENT_FAILED`/stuck deploys are recorded (log at error), Studio OOM/crash detection is out (alerts deferred) — log only what the backend sees.
- Test: `subgraphs/vetra-cloud-observability/__tests__/clint-pull-worker-dead-env.test.ts`

**Interfaces:**
- Produces: after **3** consecutive failed polls the worker checks whether the environment document still exists; if not, it calls `removeEnvironmentRecord` and stops polling it; failures for existing envs back off (max one poll per 5 min after 3 failures) instead of every 15 s; `DEPLOYMENT_FAILED` transitions and deploys stuck > 15 min log at error level.

- [ ] **Step 1: Write failing tests:** `removes the record of a deleted environment after 3 failed polls`; `backs off polling a failing existing environment`; `keeps polling healthy environments every 15s`.
- [ ] **Step 2–4:** Run → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `fix(observability): stop polling deleted environments; back off failing ones`.

### Task 14: release the backend to staging

- [ ] **Step 1:** Bring `staging` up to `main` (merge `origin/main` into `origin/staging`, resolving only the `package.json` version field to staging's); push; release run green.
- [ ] **Step 2:** Merge `feat/foundation` into `staging`; push; release run green (`0.0.x-staging.N`).
- [ ] **Step 3:** k8s: staging `PH_REGISTRY_PACKAGES` → new version, `VETRA_LLM_DEFAULT_BUDGET_USD: "10"`, `VETRA_LLM_FALLBACK_MODELS: "deepseek/deepseek-v4.1-flash,google/gemini-3.1-flash-lite"`; switchboard healthy; `vetraLlm` mutations present (introspection).

## Phase D — Website (vetra.io)

### Task 15: honest copy and the budget on the Studio card

**Files:**
- Modify: `modules/landing/studio/studio-control.tsx:4-5,29`, `studio-flow.tsx:10,12`, `studio-hero.tsx:20`, `studio-session-window.tsx:22,37`; `modules/cloud/studio/llm-client.ts:38` (add `fetchStudioLlmUsage`), `use-studio-llm-status.ts`, `components/studio-product-card.tsx:39-40,103-111`
- Test: `modules/landing/__tests__/studio-page.test.tsx`, `modules/cloud/studio/__tests__/llm-client.test.ts`, card test

**Interfaces:**
- Copy (exact): replace "Plans before code" body with `Studio explains what it will build before it builds it.`; "Every step is a commit" → title `Your work is saved`, body `Download your workspace any time; GitHub sync arrives with publishing.`; "Nothing is written until you approve." → `You can stop or redirect it at any point.`; "committed step by step" → `saved as it goes`; "Data may be lost between versions, so keep exports" → `Major version upgrades may need a re-run; keep an export of important work`; hero "You approve every plan…" → `You steer every step…` (keep the rest of the sentence).
- Card shows `$used of $limit` from `studioLlmUsage` and "Budget used up" at 100%.

- [ ] **Step 1: Write failing tests** asserting the new strings and the absence of `Nothing is written until you approve`, `Every step is a commit`, `Data may be lost between versions`; `card shows used of limit`.
- [ ] **Step 2–4:** Run `pnpm test:unit` → FAIL; implement; → PASS; `pnpm -s tsc`, lint 0 errors.
- [ ] **Step 5:** Commit; push to `staging`; after staging deploy is healthy, fast-forward/merge to `main`.

## Phase E — Live investigations on staging (systematic debugging; root cause before fix)

### Task 16: messages that never reach the agent (sync Forbidden)

**Files:** determined by the root cause (expected in ph-clint embedded switchboard auth / drive permissions, or vetra-app Connect sync config).

- [ ] **Step 1:** On a staging Studio running Task 10's agent, reproduce: send messages across an agent restart and a page reload; capture agent logs for `pollSyncEnvelopes|touchChannel … Forbidden` and the chat document's message ids vs `pickedUpAt`.
- [ ] **Step 2:** Trace which identity the browser channel uses vs the document permissions on the agent's switchboard (and whether the regenerated switchboard identity after restart is the trigger); write the root cause in the ledger.
- [ ] **Step 3: Write the failing test** reproducing the refusal at the layer that owns it.
- [ ] **Step 4:** Fix; test PASS; re-run the repro: every message gets `pickedUpAt`, no Forbidden in logs.
- [ ] **Step 5:** Commit in the owning repo; if ph-clint, release as in Task 5 and bump the Studio.

### Task 17: the `[object Object]` Renown link

- [ ] **Step 1:** Reproduce in the customer app's preview Connect (`/reactor-project/vetra-studio`), the Studio's Connect login and vetra.io login entry points; capture the URL.
- [ ] **Step 2:** Find the interpolation of an object into the URL (search the built Connect/preview config for `renownUrl` objects); root cause in the ledger.
- [ ] **Step 3–5:** Failing test at the source; fix; commit in the owning repo.

### Task 18: GitHub repo creation — root cause on staging

- [ ] **Step 1:** With Task 12 deployed to staging (staging logs at debug), create a Studio App from a staging Studio once for personal account `froid1911` and once for org `web3-berlin`; capture the failing step and error.
- [ ] **Step 2:** If it is the production-env document creation under v2 policy (system-signed via `envs.ts`), make the cloud's server-side writes acceptable (host signer identity / creation policy for system documents) — test first; otherwise fix the step identified.
- [ ] **Step 3:** Re-run both: repo created, workflow committed, production env created, App row present; no orphaned resources on a forced failure.

## Phase F — Prod rollout

### Task 19: prod platform forward to v6.2.3

- [ ] **Step 1:** k8s `tenants/vetra/powerhouse-values.yaml:96,305`: switchboard/connect `v6.2.3-dev.28` → `v6.2.3` (images exist). Push; watch migrations 021–023 apply; switchboard healthy; `__typename` query OK; Connect 200; a v2-signed test mutation (Task 6 test signer against a throwaway doc) accepted.

### Task 20: promote backend, Studio and website to prod

- [ ] **Step 1:** vetra-cloud-package: merge `staging` → `main` (version field from main), push, release; prod `PH_REGISTRY_PACKAGES` pinned to the new stable version; `VETRA_LLM_FALLBACK_MODELS` set on prod; prod budget default stays `"1"`.
- [ ] **Step 2:** Prod `STUDIO_POOL_VERSION` → Task 10 version; three warm Studios Ready.
- [ ] **Step 3:** vetra.io `main` == `staging` (Task 15) live and healthy.

### Task 21: the demo Studio

- [ ] **Step 1:** `setStudioLlmBudget(environmentId: "dfP6y6gTB0UTZ6UNGwQcv7B7nlY4CYG4OHNy0xV5y_o", limitUsd: 50)` as admin.
- [ ] **Step 2:** Owner-signed (Frank's Renown approval) `SET_SERVICE_CONFIG` (agent package version → Task 10 version, rest unchanged) + `APPROVE_CHANGES` on `vivid-slug` (method in memory `vetra-env-doc-admin-edits`).
- [ ] **Step 3:** Verify on `vivid-slug`: agent version, 16 Gi, model + fallbacks env, budget shows `$x of $50`; send a message → picked up and answered; deploy a small project → environment created (no `SCHEME_BELOW_POLICY`); a GitHub repo can be created.
