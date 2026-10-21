# Vetra Studio First Minutes (Project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room of non-coders gets from "this is how we work" (a diagram, a sheet, a description) to a live product on their phones in ~90 minutes: bring your material → "What I understood" → build with room questions → guided first change → their phones send suggestions and enter real rows → leave with a link and a time-lapse — in each person's own language (German/English), with costs in plain dollars.

**Architecture:** Browser-side features live in the Studio editor (`vetra-app/editors/vetra-studio/…`) and render from the `vetra/studio-product` document (extended additively in Task 0.3) plus small owner-only preview-server routes. Everything that reads files, calls the model or writes the live product runs in the Studio agent process (vetra-cli) behind one new route module, `preview-server/workshop-routes.ts`, dispatched by exactly one line in `server.ts` (same pattern as P4's `iterate-routes.ts`). The "What I understood" pass is a one-off model call through the same per-Studio LLM routing as the agent (`agents/llm.ts`), never a second provider path. Phones in the room use a short-lived room link (capability token) served by the same route module; they never touch owner routes.

**Tech Stack:** TypeScript; React 19 + Tailwind v4 Connect editors (vitest 4, happy-dom) in `vetra-app`; vetra-cli on ph-clint + Mastra + `@openrouter/ai-sdk-provider` (jest ESM); `exceljs` for spreadsheets; `qrcode` for QR codes; Powerhouse document models via `ph-cli generate`; Playwright staging harness (node ESM).

**Spec:** `docs/superpowers/specs/2026-10-21-first-minutes-workshop-design.md` (branch `spec/iterate-design`, commit `fbee37e` — includes Frank's "language follows the user" update to W9/§5.10). Builds on Project 4 (`docs/superpowers/plans/2026-10-21-iterate-design.md` on `feat/iterate-design`) and Projects 2+3.

## Workspaces

| Repo | Worktree | Branch | Base |
|---|---|---|---|
| vetra-cli monorepo | `/home/f/projects/vetra-cli-exp-p5` | `feat/first-minutes` | `feat/iterate-design` (`f4d3c47`) |
| per task | `/home/f/projects/vetra-cli-exp-p5-<task>` | `p5/<task>` | `feat/first-minutes` HEAD at dispatch; merged back `--no-ff` after review |
| Staging harness (P5 copy) | `/home/f/.claude/jobs/81234be8/tmp/staging-e2e-p5` | `p5` | clone of `staging-e2e` `master` |

## P4 dependencies (check the P4 ledger `/home/f/projects/vetra-cli-exp-p4/.superpowers/sdd/2026-10-21-iterate-design/progress.md` for `Task <N>: complete` and the milestone's staging acceptance before starting)

| P5 work | Needs from P4 |
|---|---|
| 0.2 release channel | P4 Task 0.1 (prerelease channel in `release.yml`) |
| 0.3 schema | P4 Task 0.3 merged (one codegen merge instead of two concurrent `studio-product.json` edits) |
| M2 | P4 M1 (1.2 `layerLines`/`StoryLayer`, 1.4 `LayerSwitch`) + M2 (2.1 `layoutPrefs`, 2.3 `ModeSwitch`/`useLayout`, 2.5 `attentionItems`) |
| M3 | P4 M3 (3.1 `attachPointLayer`, 3.3 `ChangeThis`/`sendPointRequest`) |
| M4 | P4 M8 (8.1 notes package, 8.3 `listNotes`/`NotesInbox`) |
| M6 | P4 M5 (5.1 `searchPackages`/`PackagePicker`, 5.3 `remixPackage`, `POST /iterate/remix`) |
| M1, M5, M7 | none (M7 reuses P4's `estimateCostUsd` name if 6.3 has landed; else defines it — see Task 7.2) |

## Global Constraints

- **STAGING ONLY.** Nothing in prod. No PRs to `main`. The spec's prod rollout (§5.11) is Frank's call later.
- **Coordination:** merge `feat/iterate-design` into `feat/first-minutes` at the start of every milestone and whenever a task needs a P4 piece; resolve conflicts on our side; after a merge that touched `studio-product.json`, re-run `pnpm --filter vetra-app generate` instead of hand-merging `gen/`. Never edit P4's branch or worktrees; never commit in `staging-e2e` or `staging-e2e-p4`.
- **Releases:** prereleases `0.0.9-p5.N`, dist-tag `p5`, **registry.vetra.io only** (RR-p5). Never touch the staging pool pin, dist-tags `dev`/`latest`/`p4`, or other sessions' Studios.
- Pin only P5 test Studios (created by the P5 harness), owner-signed `SET_SERVICE_CONFIG` + `APPROVE_CHANGES` (v2 signatures).
- Workflow-file pushes over SSH: `git push git@github.com:powerhouse-inc/vetra-cli.git HEAD:feat/first-minutes`; never `gh auth refresh`.
- **Commits:** conventional; **no `Co-Authored-By` / "Generated with" trailers**. PR bodies (if any) end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Public repo: neutral wording; no customer names in code, tests, fixtures or copy (synthetic construction inputs only).
- Never print secrets; short command output; **never bare `git stash`**. Scratch under `/home/f/.claude/jobs/81234be8/tmp`.
- **Document models** follow the repo CLAUDE.md: edit `studio-product.json` and run `pnpm --filter vetra-app generate` (`ph vetra` not running), never edit `gen/`, pure reducers (ids/timestamps from input), errors via the model's `errors` list (PascalCase `…Error`), error tests with the operation-index pattern (never `.toThrow()`), reducer coverage ≥ **95%** lines/branches/functions/statements (`pnpm --filter vetra-app test:coverage`). **Additive only** (new lists get defaults in `v1/src/normalize.ts`).
- **LLM provider is a per-Studio setting behind the existing routing** (`resolveLlmSettings` → one model factory in `agents/llm.ts`); no second hard-coded provider path; STACKIT itself is not added.
- New preview-server routes are **owner-only** (`requireOwner`) except the room-link routes (Task 4.1), and live in `vetra-cli/src/preview-server/workshop-routes.ts`; `server.ts` gains exactly one dispatch line.
- **Language follows the user** (W9): each browser's language = override (account menu, `localStorage` key `vetra-studio:language`) else browser default (`navigator.languages`), `de` or `en`, English fallback. Fixed texts (UI, explainers) render in the viewer's language; stored agent texts (story outcomes, room questions, "What I understood") are written in the driver's language at the time they are made.
- **Customer-facing words never used on the main path** (existing list): environment, package, registry, Harbor, image, workflow, device code, approve changes, switchboard — extended in Task 2.4 with developer vocabulary in both languages. Copy for files says "picture", "photo", "diagram", "sheet" — never "image".
- Copy is exact where this plan quotes it (English key text; German given where it matters); tests assert the strings via the catalogue key.
- `localStorage`/`sessionStorage` access always in `try/catch`; the page works without it.
- Pure UI logic lives in `.ts` modules with unit tests; components get happy-dom tests next to them (`// @vitest-environment happy-dom`, helpers in `editors/vetra-studio/test-utils/`).
- vetra-cli consumes vetra-app through `dist`: run `pnpm --filter vetra-app build` before vetra-cli typecheck/tests in every worktree. Code shared app→cli lives under an exported vetra-app path (P4 ruling R2).

## Release recipe RR-p5 (staging test build)

1. On `feat/first-minutes`: set `version` in `vetra-cli/package.json` and `vetra-app/package.json` to `0.0.9-p5.N` (N = previous + 1, start 1); commit `chore: 0.0.9-p5.N`; push over SSH.
2. `gh workflow run release.yml -R powerhouse-inc/vetra-cli --ref feat/first-minutes -f prerelease-tag=p5`; `gh run watch --exit-status`; on 409/504/E403 `gh run rerun --failed`.
3. Verify: `curl -sI https://registry.vetra.io/vetra/-/vetra-0.0.9-p5.N.tgz` → 200; `npm view vetra@0.0.9-p5.N --registry https://registry.dev.vetra.io` → not found; `npm view vetra dist-tags --registry https://registry.vetra.io` → `p5: 0.0.9-p5.N`, `dev`/`latest`/`p4` unchanged.
4. Image: `kubectl --context k3s -n clint-builds get jobs | grep 0.0.9-p5.N` → Complete (absent after 15 min → builder webhook `{"type":"publish","packageName":"vetra","version":"0.0.9-p5.N"}` via `kubectl port-forward`).
5. Pin: `PIN_VERSION=0.0.9-p5.N node run.mjs --phase pin --studio <sub>` in the P5 harness → `/preview/version` = `0.0.9-p5.N`.
6. Ledger: N, run id, evidence.

## Test commands

"Tests → FAIL → implement → PASS" means: write the named tests, run and see them fail for the missing behaviour, implement, run again green with no new failures (record pre-existing failures first).

- vetra-app: `pnpm --filter vetra-app test -- <pattern>`; `pnpm --filter vetra-app test:coverage`; `pnpm --filter vetra-app typecheck && pnpm --filter vetra-app lint`
- vetra-cli: `pnpm --filter vetra-app build` once, then `pnpm --filter vetra test -- <pattern>`; `pnpm --filter vetra typecheck && pnpm --filter vetra lint`
- harness: `node --test lib/*.test.mjs`; `node run.mjs --phase <list> [--studio <sub>]` → `summary.json`

## Review Focus

1. **A real-world sheet that isn't a clean table** — a German checklist with a title row, merged cells, blank rows and a second header line must still yield the right header row and columns; empty columns are dropped, never turned into fields. Test: Task 1.2 `title row and blank rows before the header are skipped`.
2. **One input the model can't read** — a timeout, malformed JSON or a refusal on one file must not blank the screen: the other inputs' cards still show and the failed one says `Couldn't read <file>. Describe it in a sentence instead.` Test: Task 1.3 `one failed input still returns the others with a per-file note`.
3. **Switching language mid-session** — fixed texts switch at once, stored agent texts keep the language they were written in, an unknown stored language or a missing German string falls back to English, never to a key name. Test: Task 0.4 `missing German string falls back to English, never the key`.
4. **A room link that outlives its purpose** — an expired or revoked room token gets 401 on room routes and never reaches an owner route, even when sent as the owner `?token=`. Test: Task 4.1 `room token is refused on every owner route`.
5. **Row import retried after a partial failure** — running the import again must not create duplicate records. Test: Task 1.8 `second run after a failure creates only the missing rows`.

## Plan rulings (copied into the ledger at execution start)

- P5-1: the draft ("What I understood") is a typed JSON value (`UnderstoodDraft`, Task 1.4), stored on the product as one JSON string field — a typed GraphQL mirror of the whole draft buys nothing the reducers check; costs a parse on read.
- P5-2: spreadsheets are parsed server-side with `exceljs` (xlsx) and a small RFC-4180 CSV reader (no dependency); the model sees a text table (header + ≤ 20 sample rows), never the file — deterministic and cheap.
- P5-3: pictures and PDFs go to the model as file parts in the same call; one call per input (spec §5.2), in parallel, each capped (`UNDERSTAND_MAX_OUTPUT_TOKENS = 4096`, `UNDERSTAND_TIMEOUT_MS = 75_000`), then merged deterministically (`mergeDrafts`).
- P5-4: the understand model is a config field `understandModel` (env `VETRA_UNDERSTAND_MODEL`, default = the Studio's main model) built by the same factory as the agent's models; the provider is a config field `llmProvider` (env `VETRA_LLM_PROVIDER`, only `openrouter` accepted today) — this is the "per-Studio setting" seam for STACKIT later.
- P5-5: uploads need sign-in (owner token); a signed-out drop opens sign-in and keeps only typed text (pendingIdea), not files.
- P5-6: the first build message carries the confirmed draft as text (authoritative) plus the workspace paths of the material files; no picture parts are re-sent to the agent.
- P5-7: real rows are prepared by the agent during the first build as `import/<doc-type>.json` (seed format + `mapping`), validated like seeds, and applied after the first launch by the Studio as the owner (`createDriveClient`) once the driver confirms the mapping — no extra model pass after launch.
- P5-8: room questions are structured (`product-progress` action `question` with options + default) and never block: the agent continues on the default; the supervisor takes the default after `ROOM_QUESTION_DEFAULT_MS = 120_000`.
- P5-9: Workshop is a fourth `LayoutMode` (`"workshop"`) in P4's `layoutPrefs` (per Studio per browser), entered from the account menu (`Workshop mode`), not from the Build/Review/Demo switch.
- P5-10: the message catalogue is two typed TS objects (`en` is the key source; `de: Record<MessageKey, string>` so a missing German string fails typecheck); no i18n library.
- P5-11: room links and share links are random 32-byte tokens stored server-side (`.ph/vetra/workshop/links.json`, hashed), 24 h, revocable; guests need no sign-in (Frank §9).
- P5-12: preview snapshots are taken in the driver's browser (`html-to-image`, same-origin preview frame) every `SNAPSHOT_INTERVAL_MS = 20_000` while a change is building and the preview changed, ≤ `SNAPSHOT_MAX = 60` per change, uploaded to the Studio process.
- P5-13: the time-lapse is an animated replay page served behind a share link plus a downloadable self-contained HTML file; MP4 export is not built (spec: optional).
- P5-14: change cost = Studio usage (`studioLlmUsage.usageUsd`) at change end − at start, recorded by the driver's browser (`SET_CHANGE_COST`); the agent process has no usage source. Estimates = median of recorded costs of the same kind, fallback FIRST_BUILD $1.50 / CHANGE $0.30 / understand $0.05.
- P5-15: the gallery list is `starters.json` bundled in vetra-app; a starter shows only while its package has a `starter` dist-tag on registry.vetra.io (we set it only after the starter's build check passed); "Try it" opens the starter's live product (signed-in access — anonymous access does not exist).
- P5-16: Frank's driven dry run with two phones and the prod rollout are not executed by this plan; M8 leaves a runbook.

---

## M0 — Ground

### Task 0.1: P5 staging harness, pinning and workshop inputs

**Files (in `/home/f/.claude/jobs/81234be8/tmp/staging-e2e-p5`):**
- Create: `git clone /home/f/.claude/jobs/81234be8/tmp/staging-e2e staging-e2e-p5 && git checkout -b p5`; own fresh `wallet.key` + `profile/` (never copy the originals'); vendored from `staging-e2e-p4` (copy, don't import): `ops/pin-version.mjs`, `ops/action-signature.mjs`, `phases/pin-phase.mjs`, `lib/p4.mjs` → renamed `lib/pin.mjs` (app name `vetra-p5-pin`); `lib/p5.mjs`, `lib/p5.test.mjs`, `inputs/make-inputs.mjs`, `inputs/maengelprozess.png`, `inputs/pruefcheckliste.xlsx`, `README-P5.md`
- Modify: `run.mjs` (`PHASES` gains `pin`, later `material`, `workshop`, `guided`, `room`, `timelapse`, `gallery`, `cost`, `dryrun`)

**Interfaces:**
- Produces: `lib/p5.mjs`: `p5Env()` (`PIN_VERSION`, `P5_STRICT`, `P5_LANG` default `de`), `setBrowserLanguage(context, lang)` (Playwright `locale` + `Accept-Language`), `timed(rec, id, fn)` → records `{id, ms}` into `rec.metrics.timings`; `inputs/`: synthetic German construction inputs (no real company data):
  - `maengelprozess.png` (1600×900): swimlane diagram "Mängelmanagement" with lanes `Bauleitung`, `Nachunternehmer`, `Bauherr`; steps `Mangel erfassen (Foto, Ort, Gewerk)` → `Frist setzen` → `Mangel beheben` → `Abnahme prüfen` → `erledigt / erneut offen`; drawn with node `canvas`-free SVG → PNG via `sharp` or Playwright screenshot of an inline SVG page (implementer's choice, script committed).
  - `pruefcheckliste.xlsx`: sheet `Prüfliste` with a title row `Prüfcheckliste Rohbau – Bauabschnitt B`, a blank row, header `Nr | Prüfpunkt | Gewerk | Ort | Status | Prüfer | Datum | Bemerkung`, 24 realistic rows (Status values `offen|i.O.|n.i.O.`, German dates), one merged title cell; second sheet `Gewerke` (lookup list). Generated by `make-inputs.mjs` with `exceljs`.
- [ ] **Step 1:** `lib/p5.test.mjs`: `p5Env defaults to German and strict off`; `timed records the duration under its id`. `node --test lib/p5.test.mjs` → FAIL → implement → PASS.
- [ ] **Step 2:** `node inputs/make-inputs.mjs` creates both files; open the PNG and check it reads as a process diagram; `node -e` reading the xlsx back lists 24 data rows.
- [ ] **Step 3:** Fresh identity + Studio: `node run.mjs --phase login` → record subdomain + env id as **P5 Studio A** in the ledger. (Pin runs once 0.0.9-p5.1 exists, Task 0.2.)
- [ ] **Step 4:** Commit in the harness `feat(p5): own harness copy, pinning and workshop inputs`.

### Task 0.2: P5 prerelease channel

Starts when P4 Task 0.1 is merged on `feat/iterate-design`.

**Files:** Modify (only if needed) `vetra-cli/scripts/publish/release-channel.mjs`, `vetra-cli/tests/scripts/release-channel.test.ts`

**Interfaces:** Consumes P4's `resolveReleaseChannel({ branch, prereleaseTag, version })`.
- [ ] **Step 1:** Merge `feat/iterate-design`. Test `p5 prerelease → p5 on registry.vetra.io only` (`{branch:"feat/first-minutes", prereleaseTag:"p5", version:"0.0.9-p5.1"}` → `{distTag:"p5", registries:["https://registry.vetra.io"]}`) and `p5 tag refuses a version without -p5.`. Run → if PASS with no code change, keep the tests only; else generalise the channel check to `-<tag>.N` and PASS.
- [ ] **Step 2:** Commit `ci: p5 prerelease channel`; push over SSH.
- [ ] **Step 3:** RR-p5 with `0.0.9-p5.1` (feat/first-minutes as merged); pin P5 Studio A → `/preview/version` = `0.0.9-p5.1`. Ledger the evidence.

### Task 0.3: studio-product — the P5 fields and operations

Starts when P4 Task 0.3 is merged (merge `feat/iterate-design` first).

**Files:**
- Modify: `vetra-app/document-models/studio-product/studio-product.json` (state schema + ops, then `pnpm --filter vetra-app generate`), `v1/src/normalize.ts`
- Create: `v1/src/reducers/workshop.ts` (new module `workshop`), `v1/tests/workshop.test.ts`
- Test: `v1/tests/normalize.test.ts`, `v1/tests/scenario.test.ts`

**Interfaces (produces; later tasks use these exact names):**

```graphql
type StudioProductState { …
  understood: Understood                 # null until "Build this"
  explainersSeen: [String!]!             # normalize → []
  guidedLoop: GuidedLoop!                # normalize → { status: NOT_STARTED, at: null }
  rowImports: [RowImport!]!              # normalize → []
}
type Change { …
  questions: [RoomQuestion!]!            # normalize → []
  cost: ChangeCost                       # null until recorded
}
type Understood { json: String! language: String! at: DateTime! materials: [MaterialRef!]! }
type MaterialRef { id: OID! name: String! kind: MaterialKind! }
enum MaterialKind { PICTURE PDF SHEET TEXT }
enum GuidedLoopStatus { NOT_STARTED POINTED CHANGED WENT_BACK DONE DISMISSED }
type GuidedLoop { status: GuidedLoopStatus! at: DateTime }
enum RowImportStatus { CONFIRMED DONE FAILED }
type RowImport { id: OID! materialId: OID! sheet: String! documentType: String! rows: Int! imported: Int! status: RowImportStatus! at: DateTime! failure: String }
enum QuestionAnswerBy { ROOM DEFAULT }
type RoomQuestion { id: OID! text: String! options: [String!]! defaultAnswer: String! language: String! askedAt: DateTime! answer: String answeredAt: DateTime answeredBy: QuestionAnswerBy }
type ChangeCost { startUsd: Float endUsd: Float }
```

New module **`workshop`**:
- `SET_UNDERSTOOD { json: String!, language: String!, at: DateTime!, materials: [SetUnderstoodMaterialInput!]! }` — replaces; errors `InvalidUnderstoodError` (json not parseable as an object or > 200 000 chars), `InvalidLanguageError` (not `de`/`en`).
- `MARK_EXPLAINERS_SEEN { ids: [String!]! }` — adds unseen ids, keeps order, ignores known ones.
- `SET_GUIDED_LOOP { status: GuidedLoopStatus!, at: DateTime! }` — forward only (NOT_STARTED → POINTED → CHANGED → WENT_BACK → DONE; DISMISSED from any non-final); errors `InvalidGuidedLoopTransitionError`.
- `ASK_QUESTION { changeId: OID!, id: OID!, text: String!, options: [String!]!, defaultAnswer: String!, language: String!, askedAt: DateTime! }` — errors `QuestionChangeNotFoundError`, `DuplicateQuestionIdError`, `InvalidQuestionError` (empty text, > 200 chars, > 4 options, default empty).
- `ANSWER_QUESTION { changeId: OID!, id: OID!, answer: String!, answeredBy: QuestionAnswerBy!, answeredAt: DateTime! }` — errors `QuestionNotFoundError`, `QuestionAlreadyAnsweredError`.
- `SET_CHANGE_COST { changeId: OID!, startUsd: Float, endUsd: Float }` — sets the given side(s); errors `CostChangeNotFoundError`, `InvalidCostError` (negative).
- `START_ROW_IMPORT { id, materialId, sheet, documentType, rows: Int!, at }` (status CONFIRMED) / `FINISH_ROW_IMPORT { id, imported: Int!, status: RowImportStatus!, failure: String, at }` — errors `DuplicateRowImportError`, `RowImportNotFoundError`.

- [ ] **Step 1:** Edit the model JSON (schemas, `initialValue` gains the four state fields, each op with schema, errors and reducer code mirroring `src/reducers/workshop.ts`), `pnpm --filter vetra-app generate`; `git status` shows only `studio-product.json`, `schema.graphql`, `gen/**`, `src/reducers/workshop.ts`.
- [ ] **Step 2: Tests** (operation-index pattern for every error code): `workshop.test.ts` one happy path per op and one test per error; `normalize.test.ts` `legacy document gains understood, explainers, guided loop, row imports, questions and cost defaults`; `scenario.test.ts` `workshop: understood → build → question answered by default → cost recorded → rows imported`.
- [ ] **Step 3:** `pnpm --filter vetra-app test -- studio-product` → FAIL → implement → PASS.
- [ ] **Step 4:** `pnpm --filter vetra-app test:coverage` ≥ 95% all four; typecheck + lint; `pnpm --filter vetra-app build && pnpm --filter vetra typecheck`.
- [ ] **Step 5:** Commit `feat(studio-product): fields for the workshop flow`.

### Task 0.4: Language per user — catalogue, detection, account menu

**Files:**
- Create: `vetra-app/editors/vetra-studio/i18n/messages.en.ts`, `i18n/messages.de.ts`, `i18n/language.ts`, `i18n/language.test.ts`, `i18n/useT.ts`, `i18n/useT.test.tsx`
- Modify: `shell/AccountMenu.tsx` (+ new `shell/AccountMenu.test.tsx`), `idea/IdeaScreen.tsx` (its own strings through `t` as the first user of the catalogue)

**Interfaces:**
- Produces:
  - `export const en = { … } as const` (keys dotted, e.g. `idea.heading`); `export type MessageKey = keyof typeof en`; `export const de: Record<MessageKey, string>`.
  - `type Language = "en" | "de"`; `LANGUAGE_KEY = "vetra-studio:language"`; `detectLanguage(languages: readonly string[]): Language` (first entry starting `de` → `de`, else `en`); `readLanguageOverride(): Language | null`; `writeLanguageOverride(lang: Language | null): void`; `currentLanguage(): Language` (override else detect from `navigator.languages`); `asLanguage(value: unknown): Language` (unknown → `en`).
  - `translate(lang: Language, key: MessageKey, vars?: Record<string, string | number>): string` — `{name}` placeholders; missing/empty `de` value → `en`; missing var leaves `{name}` out as `""`.
  - `useT(): { t(key, vars?): string; language: Language; setLanguage(lang: Language | null): void }` — one module store (`useSyncExternalStore`) so every mounted component re-renders on change; also sets `document.documentElement.lang`.
  - `languageHint(lang: Language): string` — `""` for `en`; for `de`: `\n\n[Studio language: German — write story lines, outcomes and questions for the customer in German.]` (used by every Studio-originated agent message from Task 1.7 on).
  - Account menu: a `Language` group with two items `English` / `Deutsch` (`role="menuitemradio"`, `aria-checked`), selecting writes the override. Labels are always in their own language.
- [ ] **Step 1: Tests:** `detects German from de-AT`; `defaults to English for fr-FR`; `override wins over the browser`; `blocked storage falls back to the browser language`; `missing German string falls back to English, never the key` (Review Focus 3, via an injected partial catalogue); `placeholders are filled`; `useT re-renders every mounted component on change`; AccountMenu `choosing Deutsch switches the idea screen heading` (`Was möchtest du bauen?`); `languageHint is empty for English`.
- [ ] **Step 2:** FAIL → implement → PASS; existing IdeaScreen tests green (English default under happy-dom); typecheck/lint.
- [ ] **Step 3:** Commit `feat(studio): language per user with a message catalogue`.

---

## M1 — Bring your material + What I understood (W2)

### Task 1.1: One model factory, provider and understand model as Studio settings

**Files:** Modify `vetra-cli/src/agents/llm.ts`, `vetra-cli/src/framework.ts` (config fields), `vetra-cli/src/agents/agent.ts` (uses the factory); Test `vetra-cli/tests/agents/llm.test.ts`

**Interfaces:**
- Produces:
  - config `llmProvider` (env `VETRA_LLM_PROVIDER`, default `openrouter`), `understandModel` (env `VETRA_UNDERSTAND_MODEL`, default = `model`).
  - `LlmSettings` gains `provider: "openrouter"` and `understandModel: string`; `resolveLlmSettings` throws `Unknown model provider "<x>". This Studio supports: openrouter.` for any other value.
  - `createModel(s: LlmSettings, opts: { modelId: string; maxOutputTokens: number; fallbacks?: string[]; fetch?: typeof fetch }): LanguageModel` — the single place a provider client is built (`createLlmModels` becomes three calls of it, behaviour unchanged).
  - `callCostUsd(result: { providerMetadata?: unknown }): number | null` — reads `providerMetadata.openrouter.usage.cost`.
- [ ] **Step 1: Tests:** `main, subagent and memory models are unchanged` (same ids/extras as today via an injected fetch capturing the request body); `understand model defaults to the main model`; `VETRA_UNDERSTAND_MODEL overrides it`; `unknown provider is refused with the supported list`; `callCostUsd reads the cost or returns null`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint. Add `ai` as a direct vetra-cli dependency at the version the lockfile already resolves for `@openrouter/ai-sdk-provider`'s peer (implementer records the version in the report).
- [ ] **Step 3:** Commit `feat(agent): one model factory; provider and understand model per Studio`.

### Task 1.2: Material intake — upload route, sheet and CSV reading

**Files:**
- Create: `vetra-cli/src/workshop/material.ts`, `vetra-cli/src/workshop/sheets.ts`, `vetra-cli/src/preview-server/workshop-routes.ts`, `vetra-cli/src/preview-server/body.ts`; tests `vetra-cli/tests/workshop/material.test.ts`, `tests/workshop/sheets.test.ts`, `tests/preview-server/workshop-routes.test.ts`; fixtures `tests/fixtures/workshop/` (a small xlsx with a title row + blank row + merged cell, a CSV with `;` separators and a BOM, a 1-page PDF, a PNG)
- Modify: `vetra-cli/src/preview-server/server.ts` (one line `if (await workshopRoutes.handle(req, res, url, method)) return;` before the 404), `preview-server/index.ts` / `triggers/preview-server.ts` (pass `workdir`, LLM config, product context), `vetra-cli/package.json` (`exceljs@4.4.0`)

**Interfaces:**
- Produces:
  - `readBody(req, limitBytes: number): Promise<Buffer>` — rejects with `BodyTooLargeError` past the limit; `MATERIAL_MAX_BYTES = 15 * 1024 * 1024`.
  - `type MaterialKind = "PICTURE" | "PDF" | "SHEET" | "TEXT"`; `materialKindOf(fileName: string, mimeType: string, head: Buffer): MaterialKind | null` (magic bytes win: PNG/JPEG/WebP/GIF/HEIC → PICTURE, `%PDF` → PDF, zip with `xl/` → SHEET, `.csv`/`text/csv` → SHEET, `.txt`/`.md` → TEXT; else null).
  - `saveMaterial(workdir, { fileName, mimeType, bytes }): Promise<MaterialInfo>` → `<workdir>/.ph/vetra/material/<id>/<safe file name>` + `meta.json`; `type MaterialInfo = { id: string; name: string; kind: MaterialKind; bytes: number; path: string; sheets?: SheetTable[] }`.
  - `type SheetTable = { sheet: string; header: string[]; types: ("text" | "number" | "date" | "yes-no" | "choice")[]; rows: string[][]; rowCount: number }` — `rows` = all data rows as display strings.
  - `readSheets(path: string): Promise<SheetTable[]>` (xlsx via exceljs, all sheets; csv via `parseCsv`); header row = first row with ≥ 2 non-empty text cells and at most one numeric cell; blank rows skipped; columns with no header and no values dropped; merged cells take the top-left value; `types` inferred from data (`choice` when ≤ 8 distinct values over ≥ 5 rows; `yes-no` for ja/nein/yes/no/x/✓/i.O./n.i.O.-style two-value columns).
  - `parseCsv(text: string): string[][]` — BOM stripped, separator sniffed among `,` `;` `\t`, quotes per RFC 4180.
  - `createWorkshopRoutes(deps: WorkshopRouteDeps): { handle(req, res, url, method): Promise<boolean> }`; route `POST /workshop/material?name=<file>&type=<mime>` (owner; raw body) → `201 { id, name, kind, sheets?: { sheet, header, rowCount }[] }`; `413 { error: "too-large" }`; `415 { error: "unsupported" }`.
- [ ] **Step 1: Tests:** `title row and blank rows before the header are skipped` (Review Focus 1); `merged title cell does not become a column`; `empty columns are dropped`; `status column of offen / i.O. / n.i.O. is a choice`; `German dates are dates`; `semicolon CSV with BOM`; `quoted separators stay in the cell`; `kind comes from the bytes, not the extension`; routes: `refuses a caller without the owner token`; `stores a sheet and returns its tables`; `a file over 15 MB gets 413 and nothing is stored`; `unknown file type gets 415`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(workshop): bring your material — upload and read sheets`.

### Task 1.3: The understand pass

**Files:** Create `vetra-cli/src/workshop/understand.ts`, `vetra-cli/src/workshop/understand-prompt.ts`, `vetra-cli/tests/workshop/understand.test.ts`; Modify `workshop-routes.ts` (`POST /workshop/understand`)

**Interfaces:**
- Consumes: Task 1.1 `createModel`, `callCostUsd`; Task 1.2 `MaterialInfo`, `SheetTable`; Task 1.4 `UnderstoodDraft`, `parseDraft`, `mergeDrafts` (vetra-app shared export).
- Produces:
  - `understand(deps: UnderstandDeps, input: { materials: MaterialInfo[]; text: string; language: Language }): Promise<UnderstandResult>`; `type UnderstandResult = { draft: UnderstoodDraft; notes: { materialId: string | null; text: string }[]; costUsd: number; ms: number }`.
  - One `generateText` call per input (text counts as one input when non-empty), in parallel, `UNDERSTAND_MAX_INPUTS = 6`, each with `UNDERSTAND_MAX_OUTPUT_TOKENS = 4096` and `AbortSignal.timeout(UNDERSTAND_TIMEOUT_MS = 75_000)`; PICTURE/PDF as file parts (`mediaType` from the kind/magic bytes); SHEET as a text table (header + ≤ 20 rows + `rowCount`) — the sheet's columns are named in the draft fields' `source`; the model replies with JSON only (prompt in `understand-prompt.ts` asks for the `UnderstoodDraft` shape, names in the user's language `language`, field types from the fixed list, steps with role, ≤ 8 things, ≤ 15 fields per thing, ≤ 12 steps, plus up to 3 open questions); reply parsed with `parseDraft` (tolerates a fenced block).
  - A failed input (timeout, provider error, unparseable) adds `notes` `{ materialId, text: "Couldn't read <name>. Describe it in a sentence instead." }` (German: `<name> konnte ich nicht lesen. Beschreib es stattdessen in einem Satz.`) and the merged draft is built from the rest; all failed → route `422 { error: "unreadable", notes }`.
  - `POST /workshop/understand { materialIds: string[], text: string, language: "de" | "en" }` (owner, JSON body ≤ 64 KB) → `200 UnderstandResult`; budget refusal from the provider → `402 { error: "budget" }`.
- [ ] **Step 1: Tests** (model injected via `deps.generate`): `a sheet's columns become fields with their source column`; `a picture is sent as a file part`; `inputs are read in parallel` (two fake 1 s calls finish < 1.5 s); `one failed input still returns the others with a per-file note` (Review Focus 2); `all inputs failing is unreadable`; `draft names come back in the requested language` (prompt contains the language instruction); `fenced JSON is accepted`; `cost is the sum of the calls`; route `owner only` and `budget error maps to 402`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(workshop): what I understood — one fast model pass per input`.

### Task 1.4: The draft and its edits

**Files:** Create `vetra-app/shared/understood-draft.ts`, `vetra-app/shared/understood-draft.test.ts`; Modify `vetra-app/package.json` (export `./shared/*` per P4 ruling R2 if P4 has not added one) and the build config so `shared/` reaches `dist`

**Interfaces:**
- Produces:
  - `type DraftFieldType = "text" | "number" | "date" | "yes-no" | "choice" | "person" | "photo" | "place"`; `DRAFT_FIELD_TYPES` in that order.
  - `type DraftField = { id: string; name: string; type: DraftFieldType; options: string[]; source: { materialId: string; sheet: string | null; column: string | null } | null }`
  - `type DraftThing = { id: string; name: string; fields: DraftField[] }` · `type DraftRole = { id: string; name: string }` · `type DraftStep = { id: string; name: string; roleId: string | null; thingId: string | null }` · `type DraftLink = { from: string; to: string; label: string }`
  - `type UnderstoodDraft = { version: 1; language: "de" | "en"; summary: string; things: DraftThing[]; roles: DraftRole[]; steps: DraftStep[]; links: DraftLink[]; questions: string[]; materials: { id: string; name: string; kind: "PICTURE" | "PDF" | "SHEET" | "TEXT" }[] }`
  - `parseDraft(raw: string, ids: () => string): UnderstoodDraft | null` — lenient: accepts a fenced block, fills missing ids, drops unknown types to `text`, clamps the limits from Task 1.3, null when no `things`.
  - `mergeDrafts(drafts: UnderstoodDraft[]): UnderstoodDraft` — things with the same normalised name (case, umlauts/ß folded, plural `-e/-en/-s` stripped) merge their fields (by normalised name, first type wins, sources kept); roles merged by name; steps concatenated in input order without duplicates; links re-pointed to merged ids.
  - Pure edits, each `(d: UnderstoodDraft, …) => UnderstoodDraft`: `renameThing(d, thingId, name)`, `addThing(d, id, name)`, `removeThing(d, thingId)` (also its links and step references), `mergeThings(d, keepId, otherId)`, `splitThing(d, thingId, fieldIds, newId, newName)`, `renameField(d, thingId, fieldId, name)`, `addField(d, thingId, field)`, `removeField(d, thingId, fieldId)`, `setFieldType(d, thingId, fieldId, type)`, `renameRole`, `addRole`, `removeRole` (clears `roleId` on steps), `renameStep`, `addStep`, `removeStep`, `moveStep(d, stepId, toIndex)`, `setStepRole(d, stepId, roleId | null)`.
  - `draftToBrief(d: UnderstoodDraft, lang: Language): string` — the text block the build gets (Task 1.7): heading `[What we understood — confirmed by the customer]`, then `Things to keep track of:` lines `- <thing>: <field> (<type>[: a|b|c]) [from <sheet> › <column>]`, `Who: <roles>`, `Steps: 1. <step> (<role>, <thing>)`, `Links: <from> → <to> (<label>)`, `Open questions: …`; English labels always (agent-facing), names as the customer wrote them.
- [ ] **Step 1: Tests:** `parseDraft fills ids and maps unknown types to text`; `limits are clamped`; `merge joins Mangel and Mängel`; `merge keeps both sources of a merged field`; `removing a thing drops its links and step references`; `split moves the chosen fields to the new thing`; `moveStep reorders`; `removing a role clears it on steps`; `draftToBrief has the exact headings and the sheet source`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint; `pnpm --filter vetra-app build` and import it from a scratch vetra-cli test to prove the export.
- [ ] **Step 3:** Commit `feat(studio): the understood draft and its edits`.

### Task 1.5: Drop your material on the idea screen

**Files:** Create `editors/vetra-studio/idea/MaterialDrop.tsx`, `idea/MaterialDrop.test.tsx`, `idea/materialList.ts`, `idea/materialList.test.ts`, `hooks/workshop-client.ts`, `hooks/workshop-client.test.ts`; Modify `idea/IdeaScreen.tsx`, `i18n/messages.*.ts`

**Interfaces:**
- Consumes: Task 0.4 `useT`; Task 1.2/1.3 routes; `resolvePreviewConfig`, `ownerHeaders` (`hooks/preview-server-client.ts`); `useEditorFileDrop` (`@powerhousedao/reactor-browser`).
- Produces:
  - `workshop-client.ts`: `uploadMaterial(file: File, signal?): Promise<MaterialCard>`; `requestUnderstanding(input: { materialIds: string[]; text: string; language: Language }, signal?): Promise<UnderstandResult>`; errors as `WorkshopClientError` with `code: "too-large" | "unsupported" | "unreadable" | "budget" | "owner" | "network"`.
  - `type MaterialCard = { id: string; name: string; kind: MaterialKind; sheets?: { sheet: string; header: string[]; rowCount: number }[] }`; `materialList.ts` reducer `materialsReducer(state, action)` for add/uploading/failed/remove (pure).
  - `MaterialDrop({ disabled, onCards(cards) })` — accepts `.png,.jpg,.jpeg,.webp,.heic,.pdf,.xlsx,.csv,.txt` by drop, paste (clipboard pictures) and a `Add a diagram, photo or sheet` button; the one-line notice above it, always visible before the first upload (§9): `Your files are read by the AI model this Studio uses.` (de `Deine Dateien werden vom KI-Modell dieses Studios gelesen.`); each file as a chip with a kind icon, sheet chips show `<rows> rows`; errors per chip (`That file is larger than 15 MB.`, `This kind of file can't be read yet.`).
  - IdeaScreen: the textarea + drop area together; the button reads `Show me what you understood` (de `Zeig mir, was du verstanden hast`) when at least one file is attached, else stays `Build it`; signed out → `savePendingIdea(text)` + sign-in (files are not kept — ruling P5-5, chip text `Sign in to add files`).
- [ ] **Step 1: Tests:** `dropping a sheet uploads it and shows its rows`; `the notice is shown before any upload`; `a too-large file shows its own error and keeps the others`; `paste of a picture adds it`; `with a file the button asks to show what was understood`; `signed out, a drop asks to sign in and uploads nothing`; client `maps 413/415/422/402/401 to codes`; forbidden words checked on the screen in both languages.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(studio): bring a diagram, photo or sheet to the idea screen`.

### Task 1.6: "What I understood" — the picture and its edits

**Files:** Create `editors/vetra-studio/understood/UnderstoodView.tsx`, `understood/ThingCard.tsx`, `understood/StepsLane.tsx`, `understood/LinksLayer.tsx`, `understood/useDraftEditor.ts`, tests `understood/UnderstoodView.test.tsx`, `understood/useDraftEditor.test.ts`; Modify `idea/IdeaScreen.tsx` (state: idea → understanding → understood), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: Task 1.4 edits; Task 1.5 `requestUnderstanding`.
- Produces:
  - `useDraftEditor(initial: UnderstoodDraft): { draft; apply(edit: (d) => UnderstoodDraft): void; undo(): void; canUndo: boolean }` (history ≤ 50).
  - `UnderstoodView({ draft, notes, onChange(draft), onBuild(draft), onBack, busy })`:
    - heading `What I understood` (de `Was ich verstanden habe`), the draft `summary` under it;
    - **things** as cards in a responsive grid (name editable in place on click; field rows `name · type`; type is a select of `DRAFT_FIELD_TYPES` with labels `Text, Number, Date, Yes / no, Choice, Person, Photo, Place` / `Text, Zahl, Datum, Ja / Nein, Auswahl, Person, Foto, Ort`; `+ Field`, remove `×` per field; a field from a sheet shows a small `from <sheet>` tag); card menu `Merge with…`, `Split…`, `Remove`; `+ Thing to keep track of`;
    - **links** drawn as SVG arrows between cards (`LinksLayer`, recomputed on resize), label at the midpoint;
    - **steps** as one horizontal lane of numbered chips (role under each, drag or `←`/`→` buttons to reorder, role select, `+ Step`);
    - notes from failed inputs as warning rows; open questions as a list `Still open` with each question;
    - buttons `Build this` (de `So bauen`) and `Back`; `Undo` (Ctrl/⌘-Z);
    - no paragraph longer than the summary (anti-goal "wall of text"); everything readable at 1280×720 without scrolling for 4 things × 8 fields.
  - The idea screen shows a waiting state after the request with the material chips and `Reading your material…` (de `Ich lese dein Material…`), and after 20 s adds `Almost there — big diagrams take up to a minute.`; Back keeps the draft.
- [ ] **Step 1: Tests:** `renaming a card updates the draft`; `changing a field type uses the short list`; `merge combines two cards`; `reordering steps by keyboard`; `remove then undo restores`; `failed-input note is shown, other cards render`; `Build this hands over the corrected draft`; `German labels when the language is German`; forbidden words in both languages.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint. Visual check: implementer adds a screenshot of the fixture draft (playwright or story HTML) to the report.
- [ ] **Step 3:** Commit `feat(studio): what I understood — a picture you can correct`.

### Task 1.7: Build this — the corrected draft starts the build

Needs Task 0.3.

**Files:** Modify `idea/startProduct.ts`, `idea/startProduct.test.ts`, `shell/StudioShell.tsx` (`onStart` takes `{ idea, draft, language }`), `vetra-cli/prompts/agent-profiles/workflow.md`, `vetra-cli/prompts/skills-tpl/example-data/` (import file section); Create `vetra-cli/src/workshop/import-files.ts`, `vetra-cli/tests/workshop/import-files.test.ts`; Modify `vetra-cli/src/commands/reactor-project/check.ts` (import files validated as a note-level check)

**Interfaces:**
- Consumes: Task 0.3 `SET_UNDERSTOOD`; Task 0.4 `languageHint`; Task 1.4 `draftToBrief`; `validateSeeds` pattern (`launch/seed.ts`).
- Produces:
  - `StartProductInput` gains `draft?: UnderstoodDraft` and `language?: Language`; with a draft: the product ops add `setUnderstood({ json, language, at, materials })` after `INIT_PRODUCT`; the first message text = `idea` (or the draft summary when the idea box is empty) + `\n\n` + `draftToBrief(draft)` + `\n\nYour material is in the workspace: .ph/vetra/material/<id>/<name>` (one line per material) + `languageHint(language)`; product name = first thing's name when the idea box is empty.
  - `IMPORT_DIR = "import"`; import file `import/<doc-type-slug>.json` = `{ source: { materialId: string; sheet: string }, documentType: string, mapping: { column: string; field: string }[], documents: { name: string; actions: { type: string; input: unknown }[] }[] }`; `validateImports(projectPath): { file: string; ok: boolean; reason?: string }[]` (schema-checked like seeds; max 500 documents per file).
  - workflow.md rule (exact): "When the first message has a `[What we understood — confirmed by the customer]` block, build exactly those things, fields, roles and steps — the customer already corrected them. Don't ask about them again. When a thing came from a sheet, also write `import/<document-type>.json` (see the example-data skill) with one document per sheet row, so the customer's real rows can be brought in after the product is live. Example data for the preview stays in `seed/` as usual."
- [ ] **Step 1: Tests:** `with a draft, the product stores the understood draft and the message carries the brief`; `German adds the language hint`; `no draft keeps today's start`; `retry does not set the draft twice`; `validateImports accepts a valid file and names the bad action`; `more than 500 rows is refused`.
- [ ] **Step 2:** FAIL → implement → PASS; vetra-app + vetra-cli typecheck/lint; `pnpm --filter vetra build:assets` and grep the built skill for `import/`.
- [ ] **Step 3:** Commit `feat(studio): build from the corrected picture`.

### Task 1.8: Your real rows in the live product

**Files:** Create `vetra-cli/src/workshop/import-rows.ts`, `vetra-cli/tests/workshop/import-rows.test.ts`, `editors/vetra-studio/live/RowImportCard.tsx`, `live/RowImportCard.test.tsx`; Modify `workshop-routes.ts` (`GET /workshop/imports`, `POST /workshop/imports/run`), `hooks/workshop-client.ts`, `live/ProductView.tsx` (card above the product), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: `createDriveClient` (`launch/product-drive.ts`, owner identity); Task 0.3 `START_ROW_IMPORT`/`FINISH_ROW_IMPORT`; Task 1.7 import files.
- Produces:
  - `listImports(ctx): Promise<ImportOffer[]>`; `type ImportOffer = { file: string; materialName: string; sheet: string; documentType: string; rows: number; mapping: { column: string; field: string }[]; done: number }` — from the live version's project, `done` from the progress file.
  - `runImport(ctx, file: string): Promise<{ imported: number; failed: number }>` — `START_ROW_IMPORT`, then each document created with `createDocument` + `applyActions` in the product drive (`productDriveId`), progress keyed by row index in `.ph/vetra/workshop/imports/<file>.json` (idempotent), `FINISH_ROW_IMPORT` DONE or FAILED with the first reason; never prefixes names with the example prefix.
  - `RowImportCard({ offer, onRun })` — shown once the product is live and an offer has `done < rows`: `Bring in your <rows> rows from <sheet>` (de `Deine <rows> Zeilen aus <sheet> übernehmen`), a two-column mapping table `Column → Field`, buttons `Bring them in` / `Not now`; progress `<n> of <rows>`; done → toast `<n> rows are in <product name>.`
- [ ] **Step 1: Tests:** `imports every row as the owner`; `second run after a failure creates only the missing rows` (Review Focus 5); `progress is recorded on the product`; card `shows the mapping before anything is imported`; `Not now hides it for this visit`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(studio): bring the sheet's real rows into the live product`.

### Task 1.9: M1 acceptance on staging

**Files (harness):** Create `phases/material-phase.mjs`; Modify `run.mjs`, `README-P5.md`.

- [ ] **Step 1:** Phase `material` (W2), browser language `de`: fresh idea screen → notice visible → drop `maengelprozess.png` + `pruefcheckliste.xlsx` + type `Mängel auf der Baustelle erfassen und nachverfolgen` → `Zeig mir, was du verstanden hast` → time to `Was ich verstanden habe` (metric `w2UnderstandMs`; repeat 3× on fresh drafts via Back for p50/p90: assert p50 ≤ 60 s, p90 ≤ 90 s) → assert ≥ 2 thing cards, a thing with ≥ 6 fields whose source is `Prüfliste`, ≥ 4 steps, roles include one of `Bauleitung|Nachunternehmer`; rename one card, change one field type, reorder one step → `So bauen` → the build starts; product doc `understood.language = de`; wait for READY → make it live → `Deine 24 Zeilen aus Prüfliste übernehmen` → `Bring them in` → 24 records in the product drive. Story outcome lines are German (heuristic: contains ≥ 1 of `ä ö ü ß der die das und` and no forbidden word).
- [ ] **Step 2:** RR-p5, pin Studio A (or a fresh one), run → `material.ok`. Fix forward in new task branches if red.
- [ ] **Step 3:** Commit harness `feat(p5): material phase (W2)`; report M1 with timings and screenshots.

---

## M2 — Workshop mode, room questions, German everywhere (W1, W9, §5.3)

Milestone start: P4 M1 + M2 complete and green; merge `feat/iterate-design`.

### Task 2.1: The Studio in German — shell, strip, idea, story, steer

**Files:** Modify every user-facing `.tsx`/copy module under `editors/vetra-studio/{shell,strip,idea,story,steps,budget,tour,failures}/` (strings → `t(...)`), `i18n/messages.*.ts`; Test: the existing tests (they keep asserting English) + `i18n/catalogue.test.ts`

**Interfaces:**
- Produces: `catalogue.test.ts`: `every German string is non-empty and differs from English unless allow-listed` (allow-list: product names, `OK`, `Studio`); `placeholders match between languages` (same `{vars}` per key). Copy modules (`changeCopy.ts`-style constants) become functions of `t` or keys; story copy built in `.ts` models takes `t` as a parameter (no React import in models).
- [ ] **Step 1:** Write `catalogue.test.ts` → FAIL (keys missing) → move strings, add German → PASS; all existing tests green; a German render test per area (`shell renders in German`, `story renders in German`) with `expectNoForbiddenWords`.
- [ ] **Step 2:** typecheck/lint. Commit `feat(studio): shell, story and steps in German`.

### Task 2.2: The Studio in German — live, versions, change, settings, preview

**Files:** as 2.1 for `{live,versions,change,settings,preview,deploy,permission,debug}/` and the P4 additions merged by then (layout, point, theme, remix, notes UI). Settings › Advanced may stay English (developer area).
- [ ] **Step 1:** Same pattern as 2.1; tests `versions panel in German`, `settings in German`.
- [ ] **Step 2:** Commit `feat(studio): live, versions and settings in German`.

### Task 2.3: Room questions — the agent asks, never waits

**Files:** Modify `vetra-cli/src/commands/product/progress.ts` (action `question`), `vetra-cli/src/product/supervisor-rules.ts` + `supervisor.ts` (default after 2 min), `vetra-cli/prompts/agent-profiles/workflow.md`; Tests `tests/product/progress.test.ts`, `tests/product/supervisor-rules.test.ts`; Create `editors/vetra-studio/story/roomQuestions.ts`, `story/roomQuestions.test.ts`, `story/RoomQuestionCard.tsx`, `story/RoomQuestionCard.test.tsx`; Modify `story/StoryPane.tsx`, P4 `shell/attention.ts`

**Interfaces:**
- Consumes: Task 0.3 `ASK_QUESTION`/`ANSWER_QUESTION`; P4 2.5 `attentionItems`.
- Produces:
  - `product-progress` action `question` with `text` (≤ 200 chars, forbidden words checked), `options` (2–4, each ≤ 60), `default` (one of `options`) → `ASK_QUESTION` (language = the change's latest `languageHint`, else `en`); tool reply `Asked. Keep working with "<default>" — if the room answers differently you'll get it as a message.`
  - Prompt rule: "When a choice is the customer's to make (wording, which fields matter, who does what), ask it with `product-progress` action `question` (2–4 short options and your default) and carry on with the default. Never stop to wait for the answer."
  - Supervisor rule `room-question-default`: an unanswered question older than `ROOM_QUESTION_DEFAULT_MS = 120_000` → `ANSWER_QUESTION { answer: defaultAnswer, answeredBy: DEFAULT }` + milestone `No answer from the room — went with "<default>".` (written in the question's language: de `Keine Antwort aus dem Raum — weiter mit „<default>“.`).
  - Browser: `openQuestions(change): RoomQuestion[]`; `answerQuestion({ productId, change, question, answer, sendSteer })` → `ANSWER_QUESTION` (ROOM) then a steer `Answer to "<text>": <answer>` (+ `languageHint`), only when the answer differs from the default; `RoomQuestionCard({ question, onAnswer, large })` — question text, one button per option (default marked `Suggested` / `Vorschlag`), a countdown `Going with the suggestion in <m:ss>`; the card is an attention item in every mode.
- [ ] **Step 1: Tests:** cli `question is recorded and the tool says to keep going`; `options must include the default`; `forbidden word refused`; supervisor `after two minutes the default is taken and the story says so`; `an answered question is left alone`; app `answering with the default sends no steer`; `a different answer is sent as a steer`; `countdown reaches zero without blocking`; `question shows as attention in Demo`.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint both packages.
- [ ] **Step 3:** Commit `feat(studio): room questions that never block the build`.

### Task 2.4: No developer words on the big screen

**Files:** Modify `editors/vetra-studio/test-utils/forbiddenWords.ts`, `vetra-cli/src/product/forbidden-words.ts`, tests of both

**Interfaces:**
- Produces: `WORKSHOP_FORBIDDEN_WORDS` (added on top of `FORBIDDEN_WORDS` for workshop-mode renders and for agent story texts): `document model`, `reducer`, `operation`, `schema`, `deploy`, `commit`, `repository`, `TypeScript`, `lint`, `build log`, `stack trace`, `JSON`, `GraphQL`, `codegen`, and German `Dokumentmodell`, `Paket`, `Umgebung`, `Schema`, `Repository`, `Commit`; `expectNoWorkshopWords(container)`; the agent-side `findForbiddenWords` also refuses the workshop words in `outcome`, `question` and `stuck` texts (not in `text` of internal milestones that only show in Raw).
- [ ] **Step 1: Tests:** `catches reducer in a story line`; `catches Paket`; `does not flag "operation" inside "cooperation"` (whole words); cli `outcome with "schema" is refused`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `test(studio): workshop vocabulary check`.

### Task 2.5: Workshop mode

**Files:** Create `shell/WorkshopLayout.tsx`, `shell/WorkshopLayout.test.tsx`, `shell/QrChip.tsx`, `shell/QrChip.test.tsx`, `shell/workshop.css` (scoped under `[data-vetra-workshop]`); Modify P4 `shell/layoutPrefs.ts` (+ test), `shell/useLayout.ts`, `shell/StudioShell.tsx`, `shell/AccountMenu.tsx`, `strip/StepStrip.tsx` (simple variant), `vetra-app/package.json` (`qrcode@1.5.4`)

**Interfaces:**
- Consumes: P4 `LayoutMode`, `useLayout`, `layerLines`, `LayerSwitch`; Task 2.3 `RoomQuestionCard`.
- Produces:
  - `LayoutMode` gains `"workshop"`; `readLayout` keeps a stored `workshop`; `effectiveMode` returns it while stored; leaving workshop restores the mode stored before (`LayoutPrefs.beforeWorkshop: LayoutMode | null`).
  - Account menu item `Workshop mode` / `Workshop-Modus` (checkbox item) toggling it.
  - `WorkshopLayout({ product, story, questions, qr, strip })` — root `data-vetra-workshop`, type scale: base 22 px, story lines 28 px, headings 40 px (readable at 4 m on 1920×1080; 13" laptop: `clamp()` so nothing overflows at 1280×800); high-contrast tokens; product left 60 %, story right at layer `outcome` with a `Show activity` toggle (never `raw` — the Raw option is hidden); room questions as large cards above the story; strip = step names only (`StepStrip variant="simple"`); no developer UI (debug panel, Advanced, raw logs hidden); `QrChip({ url, label })` persistent bottom-right, click → full-screen QR (`qrcode` `toDataURL`, size 480) with the URL in large text; target = live product URL when live, else the room link (Task 4.1; until M4 lands: the preview URL for the owner only, labelled `Preview`).
- [ ] **Step 1: Tests:** `account menu toggles workshop mode and back restores Review`; `workshop hides Raw and the debug panel`; `room question is a large card`; `QR shows the live address once live`; forbidden + workshop words checked in de and en renders.
- [ ] **Step 2:** FAIL → implement → PASS; typecheck/lint.
- [ ] **Step 3:** Commit `feat(studio): workshop mode for the big screen`.

### Task 2.6: M2 acceptance on staging

**Files (harness):** `phases/workshop-phase.mjs`, `run.mjs`, `README-P5.md`.
- [ ] **Step 1:** Phase `workshop` (W1, W9, §5.3) at 1920×1080 and 1280×800, browser `de`: account menu → `Workshop-Modus` → base font ≥ 22 px, no horizontal overflow, no forbidden/workshop word in `document.body.innerText`, QR chip present; start a change `Frag den Raum, welche Farbe der Status „offen“ haben soll, bevor du sie änderst` → a question card appears ≤ 3 min with options; answer nothing → after 2 min the story says `Keine Antwort aus dem Raum — weiter mit …`; second question answered by click → a steer is sent; switch language to English in the account menu → fixed UI English, stored story lines stay German; leave workshop mode → previous mode restored.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): workshop phase (W1, W9)`; report M2.

---

## M3 — Guided first loop + explainers (W4, W5)

Milestone start: P4 M3 complete and green; merge `feat/iterate-design`.

### Task 3.1: Concepts explain themselves once

**Files:** Create `story/explainers.ts`, `story/explainers.test.ts`; Modify `story/StoryPane.tsx` (explainer under the line), `shell/StudioShell.tsx` (marks seen), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: Task 0.3 `explainersSeen`, `MARK_EXPLAINERS_SEEN`.
- Produces: `type ConceptId = "thing" | "version" | "live" | "go-back" | "budget" | "preview" | "question"`; `EXPLAINERS: Record<ConceptId, MessageKey>` (≤ 15 words each, exact en/de):
  - thing: `A thing your product keeps track of — like a defect or an inspection.` / `Etwas, das dein Produkt festhält — zum Beispiel ein Mangel oder eine Prüfung.`
  - version: `Each change makes a new version. Older versions stay, so you can go back.` / `Jede Änderung ergibt eine neue Version. Ältere bleiben, du kannst zurück.`
  - live: `Live means people can use it now, on their own phones and laptops.` / `Live heißt: Andere können es jetzt nutzen, auf eigenen Handys und Laptops.`
  - go-back: `Going back makes an earlier version live again. Nothing is lost.` / `Zurückgehen macht eine frühere Version wieder live. Nichts geht verloren.`
  - budget: `What building costs so far, and how much this Studio may spend.` / `Was das Bauen bisher kostet und wie viel dieses Studio ausgeben darf.`
  - preview: `A preview to try things out. Only you see it until it goes live.` / `Eine Vorschau zum Ausprobieren. Nur du siehst sie, bis sie live geht.`
  - question: `The agent asks the room and keeps going with its suggestion meanwhile.` / `Der Agent fragt den Raum und arbeitet so lange mit seinem Vorschlag weiter.`
  - `conceptOf(line: StoryLine, product): ConceptId | null` (first milestone of a FIRST_BUILD → thing; first READY → version; first LAUNCHED → live; first rollback line → go-back; first budget line/warning → budget; first preview-ready line → preview; first room question → question); `explainerFor(lines, product, seen: readonly string[]): Map<lineId, ConceptId>` — only the first line per unseen concept; rendered in the viewer's language; seen ids dispatched once when the line is rendered (`MARK_EXPLAINERS_SEEN`), so it's per Studio, never again.
- [ ] **Step 1: Tests:** `first version line carries the version explainer`; `a seen concept never shows again`; `only the first line of a concept`; `each explainer is at most 15 words in both languages`; `rendering marks it seen once`; forbidden/workshop words over all explainers.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(story): concepts explain themselves the first time`.

### Task 3.2: The guided first loop

**Files:** Create `guided/guidedLoop.ts`, `guided/guidedLoop.test.ts`, `guided/GuidedLoopCard.tsx`, `guided/GuidedLoopCard.test.tsx`; Modify `shell/StudioShell.tsx`, `preview/PreviewPane.tsx` (Point on from the card), `versions/VersionsPanel.tsx` (Go back from the card), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: Task 0.3 `guidedLoop`, `SET_GUIDED_LOOP`; P4 Point (`attachPointLayer` toggle), `ChangeThis`, `sendPointRequest`; `requestRollback`.
- Produces:
  - `guidedStep(product): "offer" | "point" | "changing" | "go-back" | "back" | null` — `offer` when liveVersion = 1 and status NOT_STARTED; `point` = POINTED and no change open; `changing` = a change open since POINTED; `go-back` = CHANGED and liveVersion ≥ 2; `back` = WENT_BACK; null when DONE/DISMISSED or not live.
  - `pickSafeSuggestion(frameDoc: Document): Element | null` — the first visible heading (`h1`–`h3`) or button text in the product root (`[data-vetra-app]`) — pre-selected when the driver doesn't pick (spec §5.5); the request prefilled `Make this heading bigger` / `Mach diese Überschrift größer`.
  - `GuidedLoopCard` copy (exact): offer `Try a change: point at something on the screen.` button `Show me` · changing `The agent is making your change — usually under two minutes.` · go-back `This is Version 2 — and here is how to go back.` button `Go back to Version 1` · back `Back to Version 1. Everything you change can be undone.` button `Done`; German: `Probier eine Änderung: Zeig auf etwas auf dem Bildschirm.` / `Zeig es mir` · `Der Agent setzt deine Änderung um — meist in unter zwei Minuten.` · `Das ist Version 2 — und so gehst du zurück.` / `Zurück zu Version 1` · `Zurück bei Version 1. Alles, was du änderst, lässt sich rückgängig machen.` / `Fertig`; `×` dismiss → DISMISSED. Each move one click.
- [ ] **Step 1: Tests:** `offered once after the first launch`; `Show me turns Point on with a safe element selected and the request prefilled`; `after the change goes live the card offers going back`; `Go back requests the rollback and the card says everything can be undone`; `dismissed never comes back`; `a second Studio browser sees the same state` (state from the doc).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(studio): the guided first loop`.

### Task 3.3: M3 acceptance on staging

- [ ] **Step 1:** Phase `guided` (W4, W5), `de`: on a product live at Version 1 → card → `Zeig es mir` → `Senden` → time to Version 2 live (metric `w4LoopMs`, assert total of the three moves < 3 min including the agent) → `Zurück zu Version 1` → live version 1 → card `Zurück bei Version 1…` → `Fertig`; the explainers for version, live and go-back appeared once each; reload → none repeat.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): guided phase (W4, W5)`; report M3.

---

## M4 — The room takes part + share + QR (W8, W6 share)

Milestone start: P4 M8 complete and green; merge `feat/iterate-design`.

### Task 4.1: Room links

**Files:** Create `vetra-cli/src/workshop/links.ts`, `vetra-cli/tests/workshop/links.test.ts`; Modify `workshop-routes.ts` (`POST /workshop/links`, `DELETE`-style `POST /workshop/links/revoke`, `GET /workshop/links`), `preview-server/server.ts` only if the room paths must bypass an existing gate (implementer documents)

**Interfaces:**
- Produces:
  - `type LinkScope = "room" | "timelapse"`; `issueLink(workdir, { scope, ttlMs = 24 * 3600_000, now }): { token: string; id: string; expiresAt: string }` — 32 random bytes base64url; only the sha256 is stored in `.ph/vetra/workshop/links.json`; `verifyLink(workdir, token, scope, now): { id: string } | null`; `revokeLink(workdir, id)`; `listLinks(workdir, now)` (active only).
  - Room tokens are accepted only on `/workshop/room/<token>/…` routes (Task 4.2) and never by `requireOwner` (the operator/owner check never looks at room tokens; a room token in `?token=` on an owner route → 401).
  - Owner routes: `POST /workshop/links { scope }` → `{ id, url, expiresAt }` where `url = <proxyPublicUrl>/preview/workshop/room/<token>`.
- [ ] **Step 1: Tests:** `issued link verifies until it expires`; `revoked link is refused`; `only the hash is stored`; `room token is refused on every owner route` (Review Focus 4: iterate over the server's owner routes with `?token=<room>` and as bearer → 401); `a timelapse token is not a room token`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(workshop): room links`.

### Task 4.2: The phone page — watch and suggest, no sign-in

**Files:** Create `vetra-cli/src/workshop/room-page.ts` (server-rendered HTML + small inline script, no build step), `vetra-cli/src/workshop/suggestions-store.ts`, tests `tests/workshop/room-page.test.ts`, `tests/workshop/suggestions-store.test.ts`; Modify `workshop-routes.ts` (`GET /workshop/room/<token>`, `GET /workshop/room/<token>/state`, `POST /workshop/room/<token>/suggestion`)

**Interfaces:**
- Produces:
  - Room page: language from the phone's `Accept-Language` (`de`/`en`, override toggle stored in the phone's `localStorage`), shows the product name, what's happening now (latest outcome line, read from the product doc — stored text, as written), the preview frame of the current preview (same origin through the Studio proxy; if the preview Connect path refuses an unauthenticated phone, the page shows the latest snapshot from Task 5.1 instead and says `Live view on the big screen` — the implementer determines which and records it), and `Send a suggestion` (textarea, optional `Your name`, `Send`; ≤ 500 chars; ≤ `ROOM_SUGGESTIONS_PER_PHONE_PER_HOUR = 10` per phone cookie); expired link → `This room link has ended. Ask for a new one.`
  - `addRoomSuggestion(workdir, { text, name, phoneId, screen, at }): RoomSuggestion`; `listRoomSuggestions(workdir, { status })`; `setRoomSuggestionStatus(workdir, id, status: "OPEN" | "USED" | "DISMISSED")`; `type RoomSuggestion = { id; text; name: string | null; screen: string | null; at; status }`.
- [ ] **Step 1: Tests:** `German phone gets the German page`; `suggestion is stored with the sender's name`; `eleventh suggestion in an hour is refused politely`; `expired link page`; `page never contains owner routes or the owner token`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(workshop): phones in the room can watch and suggest`.

### Task 4.3: One inbox, share panel and QR

**Files:** Modify P4 `vetra-cli/src/notes/notes-inbox.ts` (merge room suggestions, `source: "note" | "room"`), P4 `notes/NotesInbox.tsx` (+ test), `shell/WorkshopLayout.tsx` (`QrChip` → room link while building, live URL once live), Create `share/SharePanel.tsx`, `share/SharePanel.test.tsx`; Modify `i18n/messages.*.ts`

**Interfaces:**
- Consumes: P4 `listNotes`, `NotesInbox`, `onTurnIntoChange`; Tasks 4.1, 4.2.
- Produces: `listNotes` returns room suggestions too (newest first; `sender` = given name or `Someone in the room` / `Jemand im Raum`); inbox items have `Change this` (one click → change drawer prefilled `<text>\n\n[From <sender> in the room]`, marks USED) and `Dismiss`; in workshop mode new items toast with the sender's name; `SharePanel({ liveUrl, roomLink, onNewRoomLink, onRevoke })` — two QR codes (`Try it on your phone` → room link / live product), copy-link buttons, `Ends in <h> h`, `End this room link`; opened from the QR chip and from the strip share button.
- [ ] **Step 1: Tests:** `room suggestions appear in the inbox with the name`; `Change this prefills and marks it used`; `share panel shows both QR codes`; `ending the room link revokes it`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(studio): room suggestions in the inbox; share with a QR`.

### Task 4.4: M4 acceptance on staging

- [ ] **Step 1:** Phase `room` (W8): driver browser (`de`) in workshop mode → share panel → room link; two extra Playwright contexts without sign-in (`de` and `en`) open it → each sees its own language; phone 1 sends `Bitte ein Feld für Fotos ergänzen` as `Anna` → the driver's inbox shows it ≤ 30 s with `Anna` → `Change this` → change starts; phone 2 opens the live product QR → signs in (throwaway Renown identity) → creates a record; revoke → phones get the ended page; owner routes with the room token → 401.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): room phase (W8)`; report M4.

---

## M5 — Time-lapse (W6)

No P4 dependency (uses `html-to-image`; if P4 3.2 already added it, reuse that version).

### Task 5.1: Preview snapshots during the build

**Files:** Create `timelapse/snapshots.ts`, `timelapse/snapshots.test.ts`, `timelapse/useSnapshots.ts`, `vetra-cli/src/workshop/snapshots-store.ts`, `vetra-cli/tests/workshop/snapshots-store.test.ts`; Modify `workshop-routes.ts` (`POST /workshop/snapshots?changeId=&at=`, `GET /workshop/snapshots?changeId=`), `shell/StudioShell.tsx`, `vetra-app/package.json` (`html-to-image@1.11.13` if absent)

**Interfaces:**
- Produces: `shouldSnapshot({ lastAt, lastHash, now, hash, building, count }): boolean` (building, ≥ `SNAPSHOT_INTERVAL_MS = 20_000` since the last, hash of `body.innerText + childElementCount` changed, `count < SNAPSHOT_MAX = 60`); `useSnapshots(frameRef, change)` — `toJpeg` of the frame body at max 960 px wide, quality 0.7, uploaded; never throws, never blocks the UI; server `saveSnapshot(workdir, changeId, at, bytes)` (≤ 400 KB each) → `.ph/vetra/snapshots/<changeId>/<at>.jpg`, `listSnapshots(workdir, changeId)`.
- [ ] **Step 1: Tests:** `no snapshot while nothing changed`; `at most one per 20 s`; `stops at 60`; `failed capture is ignored`; store `keeps order by time` and `refuses > 400 KB`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(timelapse): preview snapshots while building`.

### Task 5.2: The replay — frames from the history

**Files:** Create `vetra-cli/src/workshop/timelapse.ts`, `vetra-cli/tests/workshop/timelapse.test.ts`

**Interfaces:**
- Produces: `type Frame = { at: string; kind: "idea" | "understood" | "screen" | "milestone" | "live" | "change"; text: string; snapshot: string | null; draft?: UnderstoodDraft }`; `timelapseFrames(product: StudioProductState, snapshots: { changeId: string; at: string; file: string }[]): Frame[]` — idea → understood (if any) → per change: outcome lines interleaved with snapshots by time → live per launched version; `planReplay(frames, targetMs = 30_000): { frame: Frame; ms: number }[]` — durations proportional to real time, each frame 400–3000 ms, total within ±10 % of target, at most 75 frames (evenly thinned snapshots).
- [ ] **Step 1: Tests:** `idea, understood, screens and live appear in order`; `total is about 30 s`; `thins to 75 frames`; `a product without snapshots still gets a replay from its story`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(timelapse): frames from the change history`.

### Task 5.3: Replay page, share link and download

**Files:** Create `vetra-cli/src/workshop/timelapse-page.ts`, tests `tests/workshop/timelapse-page.test.ts`, `editors/vetra-studio/share/TimelapseButton.tsx` (+ test); Modify `workshop-routes.ts` (`POST /workshop/timelapse` → share link; `GET /workshop/timelapse/<token>` page; `GET /workshop/timelapse/<token>/download`), `share/SharePanel.tsx`

**Interfaces:**
- Consumes: Task 4.1 `issueLink` scope `timelapse` (if M4 is not merged yet, this task lands the `links.ts` module itself and Task 4.1 extends it — the ledger records which happened).
- Produces: `renderTimelapse(plan, { title, language }): string` — self-contained HTML (snapshots inlined as data URIs, ≤ 12 MB total; play/pause, scrub bar, captions = frame text in the stored language, understood frame drawn as simple cards), the same HTML served by the page route and by download (`Content-Disposition: attachment; filename="<slug>-timelapse.html"`); `TimelapseButton` — `Make a time-lapse` / `Zeitraffer erstellen` → opens the page in a new tab and adds its link + QR to the share panel (`Ends in 24 h`).
- [ ] **Step 1: Tests:** `page plays the planned frames`; `download is the same document as an attachment`; `expired token page`; `no owner token or route in the page`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(timelapse): a 30-second replay to share`.

### Task 5.4: M5 acceptance on staging

- [ ] **Step 1:** Phase `timelapse` on the Studio from `material`/`guided`: ≥ 10 snapshots exist for the first build; `Zeitraffer erstellen` → page plays 27–33 s, shows the understood cards and ≥ 3 screens; download size ≤ 12 MB; link opens in a fresh context without sign-in.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): timelapse phase (W6)`; report M5.

---

## M6 — Gallery of starters (W3)

Milestone start: P4 M5 complete and green; merge `feat/iterate-design`.

### Task 6.1: The gallery on the idea screen

**Files:** Create `gallery/starters.json`, `gallery/starters.ts`, `gallery/starters.test.ts`, `gallery/Gallery.tsx`, `gallery/Gallery.test.tsx`; Modify `idea/IdeaScreen.tsx`, `vetra-cli` `workshop-routes.ts` (`GET /workshop/starters` → healthy starters), `vetra-cli/src/workshop/starters-health.ts` (+ test), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: P4 `remixPackage` via `POST /iterate/remix`.
- Produces: `type Starter = { packageName: string; title: { en: string; de: string }; description: { en: string; de: string }; screenshot: string; liveUrl: string }`; `starters.json` ships 10 entries (titles en/de): Inspection checklist / Prüfcheckliste, Defect list / Mängelliste, Approvals / Freigaben, Handover protocol / Übergabeprotokoll, Meeting minutes / Besprechungsprotokoll, Inventory / Inventar, Timesheet / Stundenzettel, Knowledge base / Wissenssammlung, Site diary / Bautagebuch, Requests / Anfragen; `healthyStarters(list, fetchDistTags)` — keeps entries whose package has a `starter` dist-tag on registry.vetra.io (cached 10 min); `Gallery({ starters, onTry(starter), onStart(starter) })` — grid of cards (screenshot, title, description in the viewer's language), `Try it` / `Ausprobieren` opens `liveUrl` in a new tab, `Start from this` / `Damit anfangen` → P4 remix of `<package>@starter`; the gallery sits under the idea box (`Or start from an example` / `Oder mit einem Beispiel anfangen`).
- [ ] **Step 1: Tests:** `a starter without the starter tag is hidden`; `titles in the viewer's language`; `Start from this remixes the tagged version`; `Try it opens the live product`; forbidden words.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(studio): a gallery of starters`.

### Task 6.2: Build and publish the starters (ops, staging)

**Files (harness):** Create `phases/starter-phase.mjs`, `starters/prompts.json` (one English idea per starter, generic, no customer data), `ops/tag-starter.mjs`

- [ ] **Step 1:** For each starter: a fresh P5 Studio (pool claim) pinned to the newest p5 build → idea from `prompts.json` → READY → live (access signed-in) → record `packageName`, version, liveUrl, a 1280×800 screenshot of the live product; when the build's checks passed, `ops/tag-starter.mjs <pkg> <version>` sets dist-tag `starter` on registry.vetra.io (owner npm token from the Studio's own publish — implementer documents the credential path; never prints it). Budget: stop and ledger if a starter costs > $4.
- [ ] **Step 2:** Write the results into `gallery/starters.json` (screenshots committed under `vetra-app/editors/vetra-studio/gallery/shots/`, ≤ 150 KB each) in a normal task branch; review; merge.
- [ ] **Step 3:** Commit harness `feat(p5): build the starters`.

### Task 6.3: M6 acceptance on staging

- [ ] **Step 1:** Phase `gallery`: idea screen lists ≥ 8 starters in German; `Ausprobieren` on `Mängelliste` opens its live product; `Damit anfangen` on `Prüfcheckliste` → remix change → READY with the starter's screens; removing the `starter` tag on one (test package only) hides it within 10 min.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): gallery phase (W3)`; report M6.

---

## M7 — Cost you can see (W7)

No P4 dependency.

### Task 7.1: Record what each change cost

**Files:** Create `budget/changeCost.ts`, `budget/changeCost.test.ts`; Modify `shell/StudioShell.tsx` (hook `useChangeCostRecorder`)

**Interfaces:**
- Consumes: Task 0.3 `SET_CHANGE_COST`; `useStudioBudget` (`snapshot.usage.usageUsd`).
- Produces: `costActions(product, usageUsd: number | null, now): Action[]` — for the active change without `cost.startUsd` → `setChangeCost({ changeId, startUsd })`; for a change that is READY/LAUNCHED/FAILED/DISCARDED with `startUsd` and no `endUsd` → `endUsd`; nothing when usage is unknown; `changeCostUsd(change): number | null` (= end − start, ≥ 0). The recorder runs on each budget poll (60 s cache — ruling P5-14 accepts the imprecision).
- [ ] **Step 1: Tests:** `start recorded when a change begins`; `end recorded when it is ready`; `unknown usage records nothing`; `negative difference counts as zero`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(budget): what each change cost`.

### Task 7.2: Estimates before, spent while, total at the end

**Files:** Create `budget/estimate.ts`, `budget/estimate.test.ts`, `budget/CostLine.tsx`, `budget/CostLine.test.tsx`; Modify `understood/UnderstoodView.tsx` (`Build this` shows the estimate), `change/ChangeDrawer.tsx` (estimate under Send), `strip/StepStrip.tsx` (spent this change), `shell/WorkshopLayout.tsx` (session total), `i18n/messages.*.ts`

**Interfaces:**
- Consumes: Task 7.1; if P4 6.3 landed, P4's `estimateCostUsd(kind, ctx)` keeps its variants/review behaviour and gains kinds `first-build | change | understand` here (same function, one module); else this task creates `estimateCostUsd` with these kinds only and P4's kinds join on merge (ledger records it).
- Produces: `estimateCostUsd(kind: "first-build" | "change" | "understand" | …, ctx: { history: { kind: "FIRST_BUILD" | "CHANGE"; usd: number }[] }): number` — median of the last 10 recorded costs of that kind, fallback `FIRST_BUILD 1.50`, `CHANGE 0.30`, `understand 0.05`; `aboutUsd(x: number): string` → `about $0.30` / `etwa 0,30 $` (≥ $10 rounded to whole dollars; < $0.05 → `less than $0.05` / `unter 0,05 $`); `CostLine` texts: before `About $X of your budget` (`Etwa X $ von deinem Budget`), while `$Y so far · $L left` (`Y $ bisher · L $ übrig`), session total in workshop mode `This session: $Z` (`Diese Sitzung: Z $`, session start = when workshop mode was turned on, stored in `sessionStorage`). Plain numbers, no tokens.
- [ ] **Step 1: Tests:** `median of recent changes`; `fallback without history`; `German money format`; `session total counts from workshop start`; `no token counts anywhere` (render contains no `token`).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(budget): estimates, spent so far and session total`.

### Task 7.3: M7 acceptance on staging

- [ ] **Step 1:** Phase `cost`: `So bauen` shows `Etwa … $`; during the build the strip shows `… $ bisher`; after READY the product doc has `cost.startUsd`/`endUsd`; a second change's estimate equals the first change's recorded cost (median of one); workshop mode shows `Diese Sitzung: … $`.
- [ ] **Step 2:** RR-p5, pin, run → green. Commit `feat(p5): cost phase (W7)`; report M7.

---

## M8 — Dry runs

Milestone start: merge `feat/iterate-design`; all earlier milestones green.

### Task 8.1: The scripted room flow (acceptance §3)

**Files (harness):** `phases/dryrun-phase.mjs`, `run.mjs`, `README-P5.md`

- [ ] **Step 1:** Phase `dryrun` on a fresh P5 Studio pinned to the newest p5 build, driver `de` at 1920×1080 in workshop mode, two phone contexts (`de`, `en`): Warm-up (gallery `Ausprobieren`, phones scan the live QR) → Their reality (picture + sheet + sentence → `Was ich verstanden habe` ≤ 60 s, two corrections) → Build (room question answered by a phone suggestion relayed by the driver, one taken by default) → First look + loop (guided card, three moves) → Make it theirs (P4 theme `Bolder`, one more field via `Change this` from a phone suggestion) → Live and real (both phones: phone 2 signs in and enters a record; driver imports the 24 rows) → Close (time-lapse link, session total). Record each phase's duration against §2 (`10/10/10/15/20/10/5` min; metric `§2Deltas`), the silence gaps (longest time without a new story line or card while building; assert ≤ 30 s — anti-goal), every developer word found (assert none) and the total cost.
- [ ] **Step 2:** Run → green (fix forward via normal tasks if red). Commit `feat(p5): the room flow dry run`.

### Task 8.2: Runbook for Frank's dry run; final review

**Files:** Create `docs/workshop-runbook.md` (repo; neutral wording): before the session (Studio on the newest build, language, budget, a test input), the room flow per §2 with what to click, what to say when the agent asks the room, recovery moves (Back, Go back, ending a room link), and the cut lines (M1–M3 minimum).
- [ ] **Step 1:** Write the runbook; commit `docs: workshop runbook`.
- [ ] **Step 2:** RR-p5 final build; run phases `material,workshop,guided,room,timelapse,gallery,cost,dryrun` on fresh Studios; all green; collect `summary.json` paths and screenshots in the ledger.
- [ ] **Step 3:** Final whole-branch review (SDD), one fix wave, ledger rulings list. No PR to main, nothing in prod; report.
