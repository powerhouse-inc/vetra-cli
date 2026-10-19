# Vetra Studio — Project 1: Foundation (design)

Date: 2026-10-19 · Owner: Frank (product), Claude (build) · Status: approved for one-shot execution (spec → plan → subagent-driven build), staging first.

## Why

Vetra Studio must take a customer from "here is my product idea" to "my product is live" in one sitting, and keep improving it afterwards. It has to be good enough to win investors. Today it is a proof of concept: during one real build session (prod Studio `vivid-slug`, 2026-10-17..19) every stage dead-ended — chats died on provider errors, the $1 budget burnt out silently, deploy was refused, GitHub repo creation returned "internal server error", messages sometimes never reached the agent, and a login link opened `[object Object]`.

This project is the **reliability floor** for the whole product programme:

1. **Foundation** (this document) — nothing dead-ends, cost is visible and sane, shipping is not blocked by plumbing.
2. New Studio experience — "story while it builds, product once it runs", step strip, first-class project + versions.
3. Ship by itself — repo + CI + deploy automatically, preview next to live, one-click launch/rollback.
4. Iterate & design — new features, editor styles, app looks, point-and-click change.
5. First five minutes — templates, examples, guided first product.
6. Teams — orgs, sharing, comments.

Projects 2–6 each get their own design. Foundation must not pre-empt their UX decisions; where it adds UI it is the smallest honest surface (a button, a status line), designed to be absorbed by Project 2.

## Goals (what "done" means)

- **G1 Deploy works from a Studio.** Every document change a Studio makes (create a deploy environment, change its packages, approve) is accepted by prod's switchboard. Today the Studio's Powerhouse 6.2.1 libraries sign with legacy signatures and prod (switchboard v6.2.3-dev.28) refuses documents that require v2 (`SCHEME_BELOW_POLICY`, e.g. deploy targets `vellum-suite`, `vellum-suite-zwei` on 2026-10-19 14:41/14:42).
- **G2 A chat never dead-ends.** No provider error, rate limit, budget limit, restart or OOM leaves a session in a state the customer can't continue from. Today `chat-bridge.ts` ends the session with `ERROR` on any stream error after output, and the input bar is disabled unless `ACTIVE`.
- **G3 Cost is bounded, visible, and doesn't block work prematurely.** Requests reserve a sane number of output tokens; context per step is materially smaller; the customer always sees how much budget is left and what happens when it runs out.
- **G4 Messages always reach the agent, and the customer can tell.** A sent message is delivered and picked up, or the UI says it isn't.
- **G5 GitHub errors are actionable.** Creating the repo for a Studio App works for personal accounts and orgs; when GitHub refuses, the customer gets a specific reason and next step, never "internal server error".
- **G6 One honest Renown login link.** The `[object Object]` link is found and fixed.
- **G7 We know before the customer does.** Sessions entering error, Studio crash loops/OOMs, deployments marked failed, and stuck deploys raise an alert to us; dead environments stop being polled.
- **G8 The website doesn't promise what doesn't exist.** Landing claims ("Nothing is written until you approve", "Every step is a commit", "Data may be lost between versions") are made true or softened.

## Non-goals

- New Studio layout, step strip, story/product views, project/version model (Project 2).
- Automatic GitHub push / auto-deploy flow, preview-vs-live, rollback (Project 3).
- Single sign-on across vetra.io / Studio / agent / GitHub beyond fixing the broken link (Project 3 owns the sign-in consolidation; Foundation only removes blockers).
- Pricing/plans. Foundation makes budgets configurable and visible; the numbers are a product decision (see Decisions).

## Anti-goals (failure even if it "works")

- Breaking or losing data in existing customer Studios (claimed Studios keep their pinned agent until upgraded; the upgrade must preserve workspace, sessions, keys).
- A "retry" that silently repeats side effects (double commits, double publishes, duplicate documents).
- Masking errors: every recovered failure is still logged/alerted to us.
- Shipping to prod before staging has run it (staging first, always).

## Evidence (from 2026-10-17..19)

- `vetra-cli/src/ph-version.gen.ts` pins Powerhouse `6.2.1`; v2 action signing (`signActionV2`, `packages/shared/document-model/action-signature.ts`) first shipped in Powerhouse `v6.2.3-dev.24` and is in stable `v6.2.3`. Prod switchboard `v6.2.3-dev.28` enforces `v2-required` per document (`packages/reactor/src/signer/verify-action-signature.ts`).
- Session `60452db3`: *"This request requires more credits, or fewer max_tokens. You requested up to 131072 tokens, but can only afford 114002"*. `vetra-cli/src/agents/llm.ts` sets no `maxOutputTokens`; `agent.ts` `maxSteps: 80`; ~70k prompt tokens per step (3 sessions ≈ 21M prompt tokens, $0.94 of $1).
- Session `6613dd65`: ended `ERROR` on a single 429 from Qwen's only provider. `ph-clint/packages/clint-common/chat/chat-bridge.ts:336-366` (ERROR message + `endSession(ERROR)`), retries only before any content (`chat-session-watch.ts:~28,208`), `ChatSession.tsx:39,125` disables input unless `ACTIVE`. `VETRA_MODEL_FALLBACKS` exists (`llm.ts` `parseFallbacks`) but has no default.
- Studio agent log at 14:25: `pollSyncEnvelopes … Forbidden: insufficient permissions to read this document` on two browser sync channels, while the active session document changed and the agent processed no turn (66 log lines since 09:16).
- GitHub: `vetra-apps/service.ts` `createStudioApp` maps 401/403/404 from repo creation but later steps (Renown app identity, Harbor robot, repo variable, workflow commit, production env creation) throw unmapped; `vetra-github-auth/resolvers.ts:268-279` rethrows non-422; `github-app.ts:176-186` treats every 422 as "already exists". The production-environment creation path is suspected to hit the same v2 policy as G1. Prod logs at warn level hide all of it.
- `[object Object]`: not in the agent-authorize flow (`vetra-cli/src/auth/login-flow.ts` builds a string URL; the preview server returns correct JSON; the agent is authorized). Most likely the Renown login of the customer app's own preview Connect (`/reactor-project/vetra-studio`) or a vetra.io/Connect login link.
- Observability worker polls deleted environments forever (1,321 errors/8h for deleted `noble-fox`); customer env `vast-bird` was `DEPLOYMENT_FAILED` since 2026-10-09 unnoticed.
- Landing copy: `vetra.io modules/landing/studio/studio-control.tsx:3-13,29` and the studio-flow copy.

## Design

### F1 — Signatures that prod accepts (G1)

Move the Studio (agent + bundled Connect app) to the Powerhouse release line that signs v2 and matches what the cloud runs (target: stable `6.2.3`, or the newest `6.2.3-dev.N` ≥ 24 that matches the prod switchboard's reactor if `6.2.3` stable is behind on anything the Studio needs). Every place the Studio signs (browser Connect signer via Renown, the agent's Node signer for publish/github/deploy tools, the cloud client controllers) must produce v2 tuples.

- Add a **compatibility check** that fails CI when the Studio's Powerhouse version is below the cloud's minimum signing version, so this can't regress silently. A live check (sign a no-op action, verify with the shared verifier) belongs in the Studio's own tests.
- `RemoteDocumentController.pull` from reactor-browser 6.2.1 also queries fields prod doesn't serve (`totalCount` on `ReactorOperationResultPage`). The upgraded client must work against the prod switchboard; the plan must verify both directions (client newer/older than server) and pin to a combination proven on staging.
- Existing claimed Studios are upgraded by changing the agent service config's package version (`SET_SERVICE_CONFIG` + `APPROVE_CHANGES`), owner-signed — not `SET_PACKAGE_VERSION` alone. Foundation ships the new agent through the warm pool (staging, then prod) and documents the per-Studio upgrade; automatic upgrade of claimed Studios is Project 3.

### F2 — Chats that never dead-end (G2)

Change the chat framework (`ph-clint` `clint-common/chat/*`, chat-session document model and editor) so **errors are turn-level, not session-level**:

- **Retry mid-stream.** Retryable provider errors (429, 5xx, timeouts, connection resets) are retried with backoff even after output has started, resuming from the last durable checkpoint (the last fully written message/step), not from scratch, and never re-running a completed tool call with side effects.
- **Fallback models by default.** The agent always sends an ordered model list (OpenRouter `models`) so one provider's 429/outage switches to another provider/model automatically. The default list is configuration, set per environment by the cloud (alongside `VETRA_MODEL`); a sensible default ships in the agent (see Decisions).
- **Non-retryable errors keep the session usable.** The failed turn is marked failed with the reason (budget, auth, invalid request), the session stays `ACTIVE`, and the customer can **Retry** (re-run the failed turn) or **Continue** (send a new message). Budget errors say so and link to F3's top-up/upgrade path.
- **Resume after restart/OOM.** A turn that was in flight when the agent process died is detected on startup and either resumed or marked failed with Retry available — never left "in progress" forever.
- **Existing `ERROR` sessions** (e.g. `6613dd65`, `60452db3`) become continuable: a document upgrade or operation makes them `ACTIVE` with their last turn marked failed. No session data is lost.
- This is chat-framework behaviour shared by every clint agent, so it lives in ph-clint with tests there; vetra-cli adopts the new ph-clint.

### F3 — Bounded, visible cost (G3)

- **Output cap.** Every model request sets `maxOutputTokens` (main agent and sub-agents get separate caps sized to their real outputs; see Decisions). This alone removes the "can only afford 114002 tokens" refusals while budget remains.
- **Smaller context per step.** Measure, then cut: tools/skills exposed per phase instead of all at once, trim always-loaded instructions, lower `maxSteps`, and route to providers with working prompt caching for the configured model (verify cache hits per model/provider; DeepSeek via BaseTen showed 0 cached tokens). Target: prompt tokens per step down by at least half on the same build, proven by a before/after measurement on staging.
- **Visible budget.** The Studio shows budget used / left (from `vetraLlm.studioLlmUsage`, already served, currently unused) and warns at 80%. At 100% the agent says plainly that the budget is used up and how to add more, instead of failing a request mid-turn. vetra.io's Studio card shows the same number.
- **Configurable budgets.** Default budgets per tier/invite code stay server-side config (`VETRA_LLM_DEFAULT_BUDGET_USD`, invite-code `llmBudgetUsd`); Foundation sets realistic staging/demo values (Decisions) and makes raising a single Studio's budget a one-command admin action.

### F4 — Message delivery you can see (G4)

- Find and fix why the browser's sync channels get `Forbidden: insufficient permissions to read this document` from the agent's switchboard (identity/permission of the Studio drive vs. the signed-in user and the agent; behaviour across agent restarts where the switchboard identity is regenerated).
- Each sent message shows its state: sent → delivered to the agent → picked up (turn started). If a message isn't picked up within a threshold, the UI says so with a Retry, and we get an alert.

### F5 — Actionable GitHub errors (G5)

- Reproduce Studio App creation for a personal account and an org on staging with debug logging; find the step that fails (suspects: production-env creation under v2 policy, Renown app identity registration, Harbor robot, repo variable/workflow commit permissions).
- Fix the root cause. Map every GitHub/Harbor/Renown failure in `createStudioApp` and `vetra-github-auth` to a specific error code and message with a next step (`REPO_NAME_INVALID`, `INSUFFICIENT_PERMISSION`, `ORG_POLICY`, `REPO_EXISTS`, `GITHUB_NOT_CONNECTED`, …); `422` is no longer assumed to mean "already exists". Unexpected failures are logged with context at error level (visible at prod's warn log level) and still roll back.

### F6 — The `[object Object]` link (G6)

Reproduce in the customer app's preview Connect and in vetra.io/Connect login entry points; find where an object is interpolated into the Renown URL; fix at the source; add a test.

### F7 — Platform health (G7)

- Alerts (to us) for: session turn failures/ERROR, Studio container OOM/crash loops, environments entering `DEPLOYMENT_FAILED`, deploys stuck in progress, and Studio messages not picked up. Use the existing monitoring stack (k8s-monitoring / Sentry / alerting already in the cluster); the plan picks the concrete channel.
- The observability pull worker stops polling environments whose document is deleted or whose namespace is gone.
- Prod logging keeps warn level but every unexpected server error in Studio-facing resolvers is logged at error level with enough context to debug (no secrets).

### F8 — Honest website (G8)

Soften or remove the landing claims that aren't true yet, on vetra.io **main and staging**. Projects 2/3 restore stronger claims when they ship them.

## Constraints

- Staging first, then prod, for every service and image; pin image tags only after the image exists.
- Repos: `vetra-cli` (Studio agent + app; public), `ph-clint` (chat framework), `vetra-cloud-package` (cloud backend; staging/main), `vetra.io` (website; main + staging), `powerhouse-k8s-hosting` (config). Commits/PRs: conventional messages, **no Co-Authored-By / "Generated with" trailers**; public repos use neutral wording (no security language).
- Pushes touching `.github/workflows` go over SSH. No secrets in output, logs, commits.
- Existing Studios and their data survive every change; schema/document changes come with upgrades, never data loss.
- Agent images now build automatically from `registry.vetra.io` on release (clint-image-builder); the nightly job bumps only the staging pool; prod pool is pinned by hand.

## Decisions taken (my calls — Frank can override)

- **Powerhouse target:** stable `6.2.3` unless the plan's compatibility check proves a specific `6.2.3-dev.N` is required to match prod.
- **Output caps:** main agent 8k, code-writing sub-agents 16k output tokens (adjusted if measurement shows truncation).
- **Default fallback chain:** configured model → `deepseek/deepseek-v4.1-flash` → `google/gemini-3.1-flash-lite` (all measured this week: tool calls work; multiple providers).
- **Budgets:** staging default $10/Studio/month; the investor-demo Studio gets an explicit invite-code budget of $50; prod default stays $1 until pricing is decided (Frank), but the 80% warning and clear out-of-budget state make the limit visible instead of mysterious.
- **Retry policy:** up to 3 automatic retries per turn with backoff, then the turn fails visibly with Retry.
- **Alert channel:** see Open questions (Alertmanager currently routes everything to `null`; Discord was rejected on 2026-09-23).
- **Customer projects' Powerhouse version:** F1 moves the Studio (agent + bundled Connect) and **new** customer projects to the new line. Existing customer projects in claimed Studios stay on their version until the customer opts in; a migration path for them is Project 3. Nothing is migrated silently.
- **Base branches:** vetra-cloud-package work starts from `origin/main`; staging is first brought up to main (its 9 missing commits) so staging validation tests the right code. The earlier environment fixes are already on main.
- **F5 test identities:** the existing GitHub App installations on personal account `froid1911` and org `web3-berlin` are used for the personal/org reproduction; staging Harbor and Renown are used as they are.

## Open questions (Frank)

1. **Platform switchboard version.** Staging runs switchboard `v6.2.3-dev.45`, prod runs `v6.2.3-dev.28`, so staging can't prove the prod pairing. Proposal: bring both to stable `v6.2.3` (staging first) as part of F1.
2. **Alert channel and recipients** for G7.
3. **What the customer sees when the budget runs out.** Proposal: a "Request more budget" button that notifies us; we raise it with one admin command.
4. **Investor demo target.** Which Studio and environment (proposal: prod `vivid-slug`, owner Frank), and is there a date that should drive order?

## Left to the builder

Exact checkpoint mechanism for mid-stream resume; how delivery receipts are represented (document state vs. presence signal); which instructions/tools to trim and how to phase them; the compatibility-check implementation; alert rule details; error-code taxonomy names beyond those listed.
