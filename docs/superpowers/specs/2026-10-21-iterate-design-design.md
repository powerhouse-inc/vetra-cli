# Project 4 — Iterate & design

**Status:** draft for Frank's review · 2026-10-21
**Builds on:** `2026-10-19-studio-foundation-design.md` (Project 1), `2026-10-20-studio-experience-design.md` (Projects 2+3: story page, versions, Go back, launch).

## 1. Intent

After Projects 2+3 a customer can describe an idea, watch it get built and put it live. Changing it afterwards is still "type to the agent and hope". Project 4 makes a Vetra product something you **shape with your hands, on top of what already exists**, while the Studio stays calm and readable over a long session.

Frank's observations that started this (2026-10-21):
- The windows can't be arranged — he wants the chat at the bottom or on the right, the product in the middle.
- You can't build on an existing package (e.g. the published knowledge-note) and add features.
- After a while the chat is full of commands and failed checks; the customer loses the overview.
- (Several people from one org in one Studio → Project 6, out of scope here. Fusion → dropped.)

Frank approved all eight ideas below ("nice all of them").

**Why now:** the investor demo. There is no fixed date (Frank, 2026-10-19: order by risk). Every milestone is a cut line: if time runs short, the demo uses the milestones that are done, and M5 (Remix) moves up if the demo needs to open with it.

A product shaped by pointing at it, remixed from an ecosystem package, restyled in seconds and with a story that reads like a changelog is the difference between "an AI that writes code" and "a product studio".

## 2. Goals — what "done" means

| # | Goal | Done when |
|---|------|-----------|
| G1 | **Story in layers** | A build or change of ≥ 60 agent steps shows ≤ 12 lines in the default (Activity) layer; every check that failed and later passed is folded into one line; the Outcome layer reads as customer-facing sentences; the Raw layer still shows every tool call and log. A returning customer sees "While you were away" listing what changed since their last visit. |
| G2 | **Layout modes** | Three modes — **Build**, **Review**, **Demo** — switchable in one click; in Build and Review the chat docks right, bottom or left and the split is resizable; the choice is remembered per Studio per browser. Demo shows the product full screen with chat as a ⌘K / Ctrl-K command bar. No layout loses the steer box or a pending question. |
| G3 | **Point and change** | In the preview, "Point" mode highlights elements under the cursor; clicking one opens "Change this" with the element attached; the agent receives enough context (see §5.3) to change that exact element without asking where it is. Plain text (labels, headings, copy) can be edited in place and lands as a normal change without an agent turn when it maps to exactly one source string. |
| G4 | **A look of its own** | Each product has a theme derived from its brand sheet (colours, type, radius, density) that restyles every editor at once; a Theme panel edits it live in the preview; presets ("calmer", "bolder", "denser", "roomier") apply in one click; a theme change is a normal change → version. |
| G5 | **Remix & compose** | From the Studio a customer can browse published packages, pick one (e.g. `@powerhousedao/knowledge-note`) and either **Remix** (own copy in the workspace, provenance recorded) or **Compose** (keep it as a dependency, add own documents that reference it). When the original publishes a newer version, the Studio offers "Bring in knowledge-note 1.x changes" and merges them. |
| G6 | **Two ways, side by side** | "Show me two ways" builds two variants of one change; both are visible next to each other; picking one keeps it as the change and discards the other. |
| G7 | **The agent reviews itself** | After every version the agent runs a review pass (empty states, narrow screens, accessibility, confusing labels, broken flows) on the running preview and offers its findings as suggestions with one-click apply. |
| G8 | **Notes from the live product** | People using the live product can leave a note on a screen (opt-in per product); notes arrive in the Studio as change requests with the screen they were left on; the owner can turn a note into a change in one click. |

**Demo script (acceptance):** Remix knowledge-note → Point at a note card → "add tags" → "Show me two ways" → pick one → Theme "bolder" → Make it live → a note from the live product arrives → apply one self-review suggestion → Go back still works. All in a fresh staging Studio, story ≤ 12 Activity lines per change.

## 3. Non-goals

- Several people in one Studio, roles, shared cursors (Project 6). G8 is one-way notes only.
- Fusion / public web front ends.
- A free-form window manager (drag panes anywhere, floating windows). Modes + dock + resize only.
- A visual drag-and-drop page builder or WYSIWYG layout editing of editors' structure. Point-and-change goes through the agent; only text is edited in place.
- Pricing, licensing changes, a paid marketplace. G5 uses the registry as it is.
- Copying live data into previews; analytics.

**Anti-goals** (would make this a failure even if it "works"):
- The story gets *more* complicated. Layers must make the default view simpler than today.
- Point mode or the theme panel breaks the product's own interaction in the preview when switched off.
- Remix silently drops parts of the original (models, reducers, editors) or produces a package that doesn't build.
- A theme or text edit bypasses versions/Go back.

## 4. Constraints

- Staging first, then prod; every milestone ends with a harness acceptance phase on staging (`staging-e2e`).
- Reducers stay pure; document-model changes go through codegen, never edit `gen/`.
- The preview is same-origin with the Studio (ph-clint proxy; `BuildSection.tsx:110`, `cli.ts:246-251`); the live embed is cross-origin (`LiveEmbed.tsx:70`). Anything that touches the frame's DOM works in the preview only.
- Editors use semantic Tailwind tokens (`bg-background`, `text-foreground`, …) by prompt rule; package CSS loads in the lowest cascade layer (`connect-layer-order.ts`).
- Published Studio packages are `@vetra-apps/<slug>`; releases publish to `registry.vetra.io` only.
- Owner-only preview-server routes require the owner's Studio-bound Renown token (S1 fix, dev.13). New preview-server routes follow the same gate.
- Budgets as set by Foundation; new agent passes (self-review, variants) count against the Studio budget and must show their cost before running when > $0.50 (builder sets exact copy).
- Public repo wording stays neutral.

## 5. What each part does

### 5.1 Story in layers (G1)

Today (`story/storyModel.ts:273-414`) the story is one line per agent milestone with every chat message folded under it; check runs are separate lines; `RawDetail` lists every tool call flat.

New: one model, three views over it.
- **Outcome** — one sentence per finished milestone written *for the customer* ("Notes can now carry tags"). The agent writes it with `product-progress` (new optional `outcome` field, ≤ 120 chars); missing outcomes fall back to the milestone title.
- **Activity** (default) — milestone lines; under each, tool calls are **grouped by intent** (reading, writing specs, generating code, running checks, publishing) into one summary line each ("Wrote 3 specs · generated code · checks passed after 2 tries"). A check that failed and later passed in the same milestone collapses into that summary; only **open** problems (latest run failing, stuck, needs you) get their own line. The waiting line, steer replies and questions stay as today.
- **Raw** — today's full tool-call/log view, per milestone, plus a "copy all" for support.
- **While you were away** — on open, if the change advanced since the viewer's last visit (per-browser timestamp, localStorage, try/catch), a dismissible card lists the Outcome lines since then and anything waiting for the customer.

Grouping is deterministic (tool name → intent table); no extra LLM call.

### 5.2 Layout modes (G2)

Builds on today's splitter (`StudioShell.tsx:528-603`, persisted `vetra-studio:story-width`).
- **Build** — today's layout: story + chat on one side, preview/step detail on the other. The story/chat docks left (today's default), right or bottom.
- **Review** — product (preview, or the live view once live) in the middle at full height, chat docked right or bottom, story collapsed to its Outcome layer with "show activity".
- **Demo** — product full screen, strip reduced to a thin bar, chat as a ⌘K / Ctrl-K command bar (one input, last reply shown as a toast, "open chat" returns to Review).
- Mode + dock + size are remembered per Studio per browser (localStorage, try/catch). Default: Build while building, Review once live.
- A pending question or "needs you" always surfaces (badge on the mode switch + toast) whatever the mode.

### 5.3 Point and change (G3)

- A **Point** toggle on the preview. The Studio injects a small selection layer into the same-origin preview frame (hover outline, click to select, Esc to leave). It never changes the product's own handlers when Point is off.
- On select, "Change this" opens attached to the element. The agent receives: the element's text, tag, role/label, a short ancestor path, computed size/position, a cropped screenshot, the editor/app module in view, and the document type + id + field in view where it can be derived. To make components and fields findable, generated editors get stable `data-vetra-component` / `data-vetra-field` attributes (codegen + editor prompt rule); for older editors the agent falls back to text + ancestor path.
- **Edit text in place**: double-click a text node in Point mode → inline edit → on Enter the Studio searches the project source for that literal; exactly one match → the edit is applied as a commit in the current change (story line "Changed label 'Add note' → 'New note'"), no agent turn; zero or several matches → it becomes a "Change this" request with the old and new text.
- Live view: Point is offered on the preview of the live version (Review mode switches to it), since the live site is cross-origin.

### 5.4 A look of its own (G4)

- *(Designer's call)* The theme restyles **the product's own editors and app only**, scoped to their root element; the Connect shell around them (drive list, toolbar) is untouched.
- Every product gets a **theme**: CSS custom properties for the semantic tokens the editors already use (background, foreground, card, muted, accent, primary, border, radius, font families, density/spacing scale), light and dark. Shipped inside the product package as one stylesheet loaded by its editors; the Studio writes it, the agent never hand-edits it.
- The initial theme is derived from the brand sheet (colours by role, typography by role). The brand sheet stays the source of truth for intent; the theme file is the applied result.
- **Theme panel** (Review mode side panel): swatches, font pickers from a curated list, radius and density sliders, light/dark toggle; changes apply live to the preview frame (same-origin style injection) and become a change → version on "Keep".
- **Presets**: calmer, bolder, denser, roomier — deterministic transforms of the current theme, also offered to the agent ("make it bolder" uses the preset first).
- Editors that hard-code colours are flagged by the self-review pass (G7).

### 5.5 Remix & compose (G5)

- **Browse**: a "Start from a package" entry on the idea screen and in "Change something"; lists packages from `registry.vetra.io` search (`/-/v1/search`) with name, description, document models, latest version. No marketplace client exists; this is a thin list, not a store.
- **Remix** (default for "start from"): the Studio brings the package's source into a workspace project it owns, published as `@vetra-apps/<slug>`. *(Designer's call)* Source comes from, in order: (1) the package's public source repository — from its `repository` field, else a small curated map in the Studio (knowledge-note → `github.com/apeiron-M/bai-knowledge-note`, public, AGPL-3.0; the published tarballs carry no `repository` field and current dev builds no source maps); (2) else the `sourcesContent` of its source maps plus the document-model specifications embedded in `dist`; (3) else Remix is not offered (Compose only). The remix is done when it builds and its document models' generated reducer tests pass, plus the original's own tests when they came with the source; anything that couldn't be recovered is listed in the story, never dropped silently. Provenance (package, version, date) is recorded in the product document and a `REMIX.md`.
- **Compose**: *(designer's call)* `ph install --local <pkg>` into the project so the dependency is **bundled into the one product package** — launch, versions and Go back keep pinning exactly one package, and a dependency bump is a rebuild + new version, not an environment change. New document models reference the package's documents by PHID. Used when the customer wants to keep getting the original's updates unchanged.
- **Upstream updates**: the Studio checks the original's latest version on open (and daily for live products). For a remix it keeps the original version as an `upstream/<pkg>` git branch and offers "Bring in <pkg> <ver> changes" — a three-way merge run as a normal change; conflicts are resolved by the agent inside that change. For compose it offers a dependency bump as a change.
- **Licences** (Frank, 2026-10-21: "all our packages are AGPL basically and need to be open source when the author goes public with it"):
  - Remix is offered for any package whose licence allows modification (AGPL, GPL, MIT, Apache, …); others are Compose only.
  - A remix keeps the original's licence (AGPL stays AGPL) and the original's notices; `REMIX.md` and the product's `LICENSE` record it.
  - **Going public = source public.** Before the first Make it live of a product that contains AGPL code (remixed or composed), the Studio shows: "This product builds on <pkg> (AGPL). Going live makes its source public." Going live then requires a public source location: the product's GitHub repo set to public (M4 GitHub connection), or, when no GitHub is connected, a source archive of that version published by the Studio. The live product gets a small "Source" link to it (footer/about), satisfying AGPL §13. Owner-only products (ProductAccess OWNER_ONLY) are not public and skip this.

### 5.6 Two ways, side by side (G6)

- "Show me two ways" (button next to Send, and a phrase the agent recognises) starts **two variants** of the current change on two git branches from the change base.
- Both run as previews at once when the Studio has the resources; otherwise variant B builds after A and a switcher flips between them (the builder decides from measured pod memory; target: both visible).
- Review shows them side by side with the same document open in both; "Keep A" / "Keep B" merges that branch into the change and discards the other (branch kept in `refs/vetra/variants/` for a day).
- Cost is shown before starting (two builds).

### 5.7 The agent reviews itself (G7)

- After every successful launch (and on demand: "Review it"), a review pass runs on the preview of that version: narrow-screen render, empty states (new empty document), keyboard/labels/contrast basics, hard-coded colours, labels the brand voice says to avoid.
- Findings become suggestions in the existing suggestions module, extended with a `kind` (REVIEW vs IDEA) and an optional screenshot; "Apply" = USE_SUGGESTION → a change; at most 3 shown, most important first.
- The pass is cheap and bounded (one agent turn budget, builder sets the cap) and skipped when the budget is low.

### 5.8 Notes from the live product (G8)

- Opt-in per product (Settings): "Let people using <name> send you notes".
- When on, the product's editors/app show a small "Send a note" button (bottom corner); a note carries text, the screen/editor and document in view, and the sender's Renown address (shown to the owner only; needed for the per-sender cap).
- *(Designer's call)* The note document model and the button component ship in **one shared package** (`@vetra-apps/product-notes`, owned by Vetra, versioned on its own) that the launch installs next to the product package when notes are on. It is not part of the customer's product, so it never counts in the versions/Go back data-compatibility gate. No Connect platform change.
- The Studio reads them as the owner (the Studio agent's owner-delegated identity, as launch already uses) from the live product's drive and shows them in an inbox on the strip ("2 notes"); each note: "Turn into a change" (pre-fills Change this with the note + context) or "Dismiss".
- Spam guard: signed-in senders only (product access already defaults to SIGNED_IN); a per-sender daily cap.

## 6. Milestones (suggested order — builder may parallelise independent ones)

1. **P4-M1 Story in layers** (G1) — fixes today's pain; no dependencies.
2. **P4-M2 Layout modes** (G2).
3. **P4-M3 Point and change** (G3) — needs M2's Review mode.
4. **P4-M4 A look of its own** (G4) — uses M2's panel slot; independent of M3.
5. **P4-M5 Remix & compose** (G5).
6. **P4-M6 Two ways** (G6) — needs M2 layout.
7. **P4-M7 Self-review** (G7) — benefits from M4 (theme checks).
8. **P4-M8 Notes from live** (G8).
9. **P4-M9 Demo** — the demo script above, end to end on staging, then prod with the Projects 2+3 rollout rules.

## 7. Left to the builder

Exact copy and visuals within the Studio's existing design language; the tool-name → intent table; how the selection layer is injected (script tag vs direct DOM via `contentWindow`); screenshot method; theme token names beyond today's semantic set; curated font list; three-way merge tooling; variant resource strategy; review pass checklist details; notes storage schema. Each such call is recorded in the plan's ledger as a ruling.

## 8. Open questions for Frank

- ~~Q1 Remixing other people's packages~~ — answered (§5.5 Licences).
- **Q2 Notes from live — who can send.** Unanswered; *going with the default:* any signed-in visitor of the live product, capped per day. Revisit with Project 6.
