# Vetra Studio — Projects 2 + 3: Studio Experience (design)

"Story while it builds, product once it runs, ships by itself."

Date: 2026-10-20 · Owner: Frank (product), Claude (build) · Status: design for review, then plan → build, staging first.
Builds on: `docs/superpowers/specs/2026-10-19-studio-foundation-design.md` (Project 1, shipped as Studio `0.0.8-dev.8`).

Reading guide: sections 1–4 say what and why; 5 is the experience screen by screen; 6–8 are the model underneath (project, versions, launch, GitHub); 9–11 are rules, decisions and open questions; 12–13 are what's left to the builder and the delivery outline. Anything marked **(guess)** is an assumption the builder should confirm with a measurement or a quick check, not a fact.

---

## 1. Intent

The CEO, verbatim:

> "the customer should easily enter his product idea and see how the agent fills out all the different steps and how it gets deployed as soon as its ready (github connected serverside/client side i dont care, it should work)"
>
> "imo the current design how we show which tab is selected and the progress is also kind of in kinder shoes. really think from blank surface."
>
> "when its done it should be also possible to improve and iterate to make it an even better product."
>
> "right now the vetra studio is like a poc, but not a proper mvp or even a product. there is so much missing."
>
> "we need to attract investors" … "no mistakes, think beyond".

He chose the **hybrid** direction: one page with two states.

1. **While it builds** — a step strip on top (Plan · Data · Editors · Tests · Live, with budget and time left), the agent's running story on the left with a box to steer it, and a live preview on the right that grows as the agent works.
2. **Once it runs** (and every visit after) — the product fills the screen; the strip shows `● Live · <name>.vetra.io ↗`, "Deployed 2 min ago · GitHub ✓", and a "Change something" bubble.

Rejected alternatives (from `directions.html`): **A Blueprint** (a checklist board as the centre; chat as a side channel — reads like a project-management tool, not a product), **B Story** alone (great while building, but nothing to show once it runs), **C Product first** (the app fills the screen from minute one — empty and confusing for the first minutes). The hybrid takes B for state 1 and C for state 2.

### Why

The investor demo is one sentence: **"Idea in, live product out, in one sitting — and it keeps getting better after."** Everything in this document serves that sentence or protects it from breaking on stage.

Today (Studio `0.0.8-dev.8` on staging) the parts mostly exist but the experience doesn't: a full first build of "create todo app product" reaches a working preview in about **4 minutes / 80+ agent steps for $0.06–0.15**, but the customer watches a raw tool-call log, has to find the right one of four tabs (IDEATE / SPECIFY / BUILD / DEPLOY), then go to a deploy page, connect GitHub through a device code, pick or create an environment, and approve. There is no notion of "my product", no history of what went live, no way back.

Projects 2 and 3 are designed together because they are one experience: P2 is the page and the project model, P3 is what makes "Live" happen by itself and makes change safe. Built separately they would each need a throwaway half of the other.

---

## 2. Goals (testable)

Each goal has a check the builder can run on staging. "Standard prompt" = `create todo app product`, plus a second, harder one: `An office suite: docs, sheets, slides`.

- **G1 One page, two states.** A Studio opens either on the blank idea screen (no product yet), the build view (product not live yet), or the product view (product live). There are no tabs to choose between; the step strip is the only navigation. *Check:* no route/tab other than strip steps, Settings and Versions is reachable from the main UI.
- **G2 Idea to live URL in one sitting.** For the standard prompt: first preview visible in ≤ 6 min, live URL working in ≤ 15 min from pressing Build (median of 5 staging runs), with zero clicks after Build other than sign-in/permission prompts. *Check:* scripted staging E2E (the existing harness) timing each milestone.
- **G3 The customer always knows what is happening.** At every moment of a build the strip shows which step is active and its progress, and the story's newest line is at most 30 s old while the agent is working (or says why it's waiting). *Check:* E2E samples the story every 10 s; no gap > 30 s without a waiting/stopped line.
- **G4 No dead ends.** Every failure state in §5.9 shows a plain reason and at least one action that moves forward (Retry, Continue, Request budget, Reconnect, Undo). *Check:* each failure state has an E2E or component test that asserts the reason text and a working action.
- **G5 Ships by itself.** The first version goes live automatically when its checks pass. The customer never has to understand GitHub, registries, images or environments to get a live URL. *Check:* E2E reaches Live with GitHub **not** connected.
- **G6 Safe change.** After launch, every change is built in a preview next to the live app; the live app is untouched until the customer presses **Make it live**; that takes ≤ 3 min to be live (median). *Check:* E2E: change request → preview shows the change, live URL still shows the old version → Make it live → live URL shows the change.
- **G7 Every launch is a version you can go back to.** The Versions list shows every launch with a title, time and who/what made it; **Go back** to any compatible version takes ≤ 3 min and loses no customer data. *Check:* E2E: launch v2, create documents in the live app, roll back to v1, roll forward to v2: all documents present and readable in v2.
- **G8 The agent proposes the next improvement.** After each launch the product view offers 2–3 concrete improvement suggestions; one click starts that change. *Check:* suggestions appear after launch in the E2E; clicking one starts a change.
- **G9 GitHub works without thinking about it.** When connected, every launch is a commit + tag in the customer's repo, in a personal account **or an organisation**. When not connected, nothing is blocked and the code is still safe. *Check:* staging E2E with `froid1911` (personal) and `web3-berlin` (org).
- **G10 Cheaper, shorter builds.** A full first build of the standard prompt finishes in ≤ 60 agent steps (today 80+, hitting the cap) and ≤ $0.20 at the configured model. *Check:* step count and cost recorded by the E2E harness.
- **G11 Existing Studios keep working.** Every existing staging and prod Studio opens in the new experience with its work intact (specs, models, editors, chats, environments, GitHub connection). *Check:* upgrade test on a copy of `rapid-fox` (staging) and `vivid-slug` (prod) before prod rollout.

## 3. Non-goals (other projects own these)

- **P4 Iterate & design:** visual/point-and-click editing, editor styles and app looks, design systems, "make it prettier" tooling, adding whole new feature areas through guided flows. P2/P3 only provide the generic "Change something" loop through the agent.
- **P5 First five minutes:** templates, sample products, guided tour, onboarding. P2 keeps the three example ideas as one-click chips (they exist today) and nothing more; the old product tour is removed, not replaced.
- **P6 Teams:** several people in one Studio, sharing previews, comments, roles, an agent signing identity per team. Renown organisations owning a product are only touched where GitHub org repos need it (G9).
- Pricing, plans and billing. Budgets stay as Foundation set them (§9).
- Custom domains for live products (the cloud supports them; the UI stays out of P2/P3).
- Several products per Studio (see designer's call D2).
- Copying live data into previews; analytics on the live product.
- Alert routing (Frank, 2026-10-19: deferred).

## 4. Anti-goals (failure even if it "works")

- **A spinner with no story.** Any wait longer than 5 s without a line saying what's happening and what comes next.
- **A deploy that needs the customer to understand plumbing.** Any customer-facing word "environment", "package", "registry", "Harbor", "image", "workflow", "device code", "approve changes", "switchboard" on the main path. (They may appear in Settings › Advanced.)
- **Losing work.** A rollback, failed launch, failed build, budget stop, restart or upgrade that deletes or silently rewrites customer documents, specs, code or chat history.
- **Breaking the live app while changing it.** Any path where an unfinished change reaches the live URL.
- **A fake progress bar.** Steps or time estimates that move without real work behind them, or a "~2 min left" that runs negative.
- **Two GitHub connections.** Asking the customer to install or authorise two different GitHub apps.
- **A demo that only works on the demo machine.** Anything that requires hand-preparing a Studio before the demo.
- **Silent cost.** A build that spends the budget without the strip showing it.

---

## 5. The experience

### 5.1 Layout principles

- **One strip, always visible.** Top of the page, full width, ~48 px. Left: product name (editable). Centre: the five steps. Right: budget and time left (while building) or nothing extra (when live). The strip is also the navigation: clicking a step opens what the agent made in that step.
- **Two panes while building, one when live.** Building: story on the left (resizable, default ~38%), preview on the right. Live: the product fills the page; the agent lives in a bubble that opens a drawer.
- **The right pane follows the agent** unless the customer clicked something; then a small chip "Following you · Back to the build" returns to auto-follow. This replaces the "Auto-follow agent" toggle.
- **Plain words.** Copy is in the customer's language; technical detail is one click away (expand a story line), never in the way.

### 5.2 Step strip

Steps and what they mean (designer's call D5 keeps the CEO-approved labels):

| Step | Done when | Count shown while active | Clicking it shows |
|---|---|---|---|
| **Plan** | product brief + feature list written, name chosen | features planned, e.g. "9 features" | the brief: problem, audience, feature list (today's ideation documents, read-only view with "Edit") |
| **Data** | every document model generated cleanly with reducers | `2/3` models | each data model in plain terms: "A Task has a title, a due date, a status (To do, Doing, Done)" + operations as verbs; "Show schema" expands |
| **Editors** | every editor (and the app view, if any) renders in preview | `2/3` screens | the preview of each editor/app, switchable |
| **Tests** | type check, lint and reducer tests pass | `12/14` checks | the checks list, each passing/failing with a one-line plain reason |
| **Live** | a version is live and healthy | "Going live…" | live state: URL, last launch, Versions, GitHub status |

Step states (icon + text, never colour alone):

- `○` not started (grey) · `◐` working (animated subtly, with count) · `✓` done · `!` needs you (amber; e.g. waiting for permission) · `✕` stopped (red; reason in story) · `●` Live (green, only on the Live step).
- A step can go back from ✓ to ◐ when the agent returns to it (e.g. Tests fail and the agent edits a model). The strip shows this honestly; the story says why ("Going back to Data: the due-date check failed").

Right side of the strip while building: `$0.31 of $10 · ~6 min left`.

- Budget comes from the Foundation meter (`studioLlmUsage`). 80% → amber; 100% → red with "Request more budget".
- Time left (designer's call D9): shown only once the plan exists, computed from the planned work (models, editors, checks remaining) times per-phase averages measured on staging, rounded up to whole minutes, shown as `~N min left`. If the estimate is exceeded it switches to "taking longer than usual" — never negative, never a bar that jumps back.

Once live, the strip reads: `✓ Plan ✓ Data ✓ Editors ✓ Tests ● Live · todo-board.vetra.io ↗` and below/next to it in small text `Deployed 2 min ago · GitHub ✓`. The completed steps stay clickable (they show the current version's plan/data/screens/checks).

### 5.3 State 0 — first visit, blank surface

Shown when the Studio has no product yet (new Studio, or an old Studio with an empty workspace).

- Centre of an otherwise empty page: a large input.
  - Heading: **"What do you want to build?"**
  - Placeholder: "Describe your product in a sentence or two — who it's for and what they do with it."
  - Button: **Build it**
  - Below: three example chips (existing examples, shortened): "Hotel breakfast orders", "Maintenance requests", "Invoice approvals". Clicking fills the input; it doesn't start building.
- Top right: budget ("$10 to spend") and account menu. No strip yet (nothing to show), no session list, no tabs.
- Not signed in: the input still works; pressing **Build it** opens sign-in, and the typed idea survives the round trip (stored locally until the product document exists). Fixes today's "drive not found" first impression.
- First build also needs the agent's permission to publish (today's "Authorize agent" button). Designer's call D7: ask once, right after sign-in, in the same modal: **"Let your Studio build and publish for you"** — one Renown confirmation. If the customer declines, the build still runs (it doesn't need it); the Live step shows `! needs you` with the same button when it gets there.

What happens on **Build it**: the product document is created (§6), the first conversation is created automatically (no "+ New session"), the idea is sent as the first message, and the page switches to state 1 immediately — the first story line appears within 2 s: "Got it — planning *Hotel breakfast orders*."

### 5.4 State 1 — building

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Hotel Breakfast ✎   ✓ Plan  ✓ Data  ◐ Editors 2/3  ○ Tests  ○ Live   $0.31 of $10 · ~6 min left │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ "Guests order breakfast from  │  Live preview · updates as it builds          │
│  a QR code; staff work a      │  ┌──────────────────────────────────────────┐ │
│  kanban queue."               │  │  (the editor / app the agent is on,      │ │
│ ✓ Planned 1 app · 7 features  │  │   with sample data)                      │ │
│ ✓ Designed Order and Menu data│  │                                          │ │
│ ✓ Order editor                │  │  Kitchen queue — building…               │ │
│ ◐ Kitchen queue app — columns,│  └──────────────────────────────────────────┘ │
│   drag between statuses       │  [Order editor] [Menu editor] [Kitchen queue] │
│   writing QueueBoard.tsx…     │                                               │
│   ⟲ retried once on a backup  │                                               │
│     model                     │                                               │
│ ┌───────────────────────────┐ │                                               │
│ │ Steer it: "add a Ready    │ │                                               │
│ │ column"…              [→] │ │                                               │
│ └───────────────────────────┘ │                                               │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

**The story (left).** The customer's idea at the top in quotes. Below it, one line per milestone, newest at the bottom, auto-scrolling unless the customer scrolled up.

- Milestone lines are written by the agent through a progress tool (§6.3), not guessed from tool calls. Examples: "✓ Planned 1 app · 7 features", "✓ Designed the Order and Menu data", "◐ Building the Kitchen queue — columns, drag between statuses".
- Under the active milestone, one live "doing now" sub-line derived from the current tool call, in plain words: "writing QueueBoard.tsx…", "running the checks…", "starting the preview…". These come from the existing tool renderers, rephrased.
- Each line expands to the raw detail (tool calls, files, diffs, terminal output) — today's chat transcript, unchanged, just folded.
- Recovered problems are shown, small and calm: "⟲ retried once on a backup model", "⟲ fixed 2 type errors". (Foundation keeps them logged for us.)
- The agent's own words (its replies) appear as normal chat bubbles in the same column; questions it asks are highlighted with an answer box.

**Steer box.** At the bottom of the story, always enabled while building. Placeholder: `Steer it: "make slides 16:9"…`. A steer message is shown in the story immediately with its delivery state from Foundation (sent → seen by the agent). Designer's call D10: a steer must take effect during the current build — the agent reads it at its next step, not after the turn ends. The agent confirms in one line ("Got it — adding a Ready column") and the strip may move back to the affected step.

**Stop.** A small "Pause" control next to the steer box stops after the current step; the story says "Paused — nothing is lost. Continue when you're ready." with **Continue**.

**Preview (right).** The Studio's own preview (today's BUILD pane), always showing the thing the agent is working on:

- Before anything renders: a skeleton with the current activity, never a blank frame: "Setting up your project (about 30 s)…", then "Starting the preview…".
- Editors and the app appear as tabs under the preview as they become available ("Order editor · Menu editor · Kitchen queue"). The tab of the step in progress shows "building…".
- Sample data is created by the agent (it already does this for previews), so the preview never shows an empty editor.
- The preview reloads in place when files change (hot reload exists); the scroll position and selected tab are kept.

**Tests step.** When the agent reaches Tests, the preview stays; the story shows the checks as they run ("Type check ✓ · Lint ✓ · 12 of 14 reducer tests ✓"). A failure isn't scary: "2 tests failed — fixing", strip goes back to Data or Editors and forward again. Checks are what already exists (`reactor-project-check`, reducer tests); designer's call D11 adds a "the preview renders without errors" smoke check so "tests pass" means "it works", not only "it compiles".

### 5.5 Going live (first time)

When Tests turn ✓ on the first build, Live starts by itself (designer's call D3: first launch automatic, later launches one click).

- Strip: `◐ Live · Going live…`. Story lines, each with real progress behind it:
  1. "Saving version 1" (commit + tag in the Studio's code history; GitHub too if connected)
  2. "Publishing your product" (packages published)
  3. "Starting your live app at **hotel-breakfast.vetra.io**" (environment rolled out)
  4. "Checking it's up" (health check of the live URL)
- Because the live environment is prepared in the background during the build (designer's call D8), steps 3–4 usually take 1–3 min, not 5–10.
- Done: confetti-free but unmistakable — the page transitions to state 2 with the live app filling the screen and a one-time banner: **"Your product is live."** `hotel-breakfast.vetra.io ↗` · **Copy link** · "Anyone with the link can sign in and use it."

If the customer has left the page, the launch still happens (it runs server-side, §7). On return they land in state 2 with "Went live 12 min ago" in the banner.

### 5.6 State 2 — product view (live)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Hotel Breakfast ✎  ✓ Plan ✓ Data ✓ Editors ✓ Tests ● Live · hotel-breakfast.vetra.io ↗ │
│                                   Deployed 2 min ago · GitHub ✓ · Version 3 ▾ │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                 (the live product, full width and height)                    │
│                                                                              │
│                                                          ┌─────────────────┐ │
│                                                          │ 💬 Change something│
│                                                          └─────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **What fills the screen:** the live product as its users see it (the live Connect with the product's app/drive open), embedded. Designer's call D12: embedded live app, with "Open in new tab ↗" — if embedding is blocked (auth, frame policy) the Studio shows the preview of the current version instead, labelled "Preview of Version 3 — open the live app ↗".
- **"Change something"** bubble bottom-right. Opens a drawer (right side, ~40%) with the story of past changes grouped by version ("Version 3 — Added a Ready column") and an input: **"What should change?"**. Below the input: the agent's suggestions as chips (§5.8).
- **Version 3 ▾** opens the Versions panel (§5.7).
- **Settings** (gear in the account menu): name, live address (read-only in P2/P3), GitHub, budget, Advanced (the old environments/deploy views for power users and existing deployments; §6.6).

### 5.7 Changing a live product: preview copy → launch → versions → rollback

**Ask.** Customer types "Add a 'notes for the kitchen' field" (or clicks a suggestion). The drawer becomes the story of this change; the page splits: **Live** (left, small, unchanged) | **Preview** (right, large). The strip stays in "live" mode but shows the change's progress next to Live: `● Live · v3   ◐ Change: Data 1/1 · Editors · Tests`.

Copy for the split: label over left pane "Live — what your users see now"; over right pane "Preview — your change, not live yet".

**Build.** Same story mechanics as state 1, scoped to the change. Typical small change: preview updated in ≤ 5 min **(guess; measure)**.

**Ready.** When the change's checks pass, a bar appears over the preview:

> **Ready to go live.** "Notes for the kitchen" · checks passed · [**Make it live**] [Keep changing] [Discard]

- **Make it live** → same four launch lines as §5.5, ~1–3 min; the left pane updates; the drawer shows "Version 4 is live." and the split closes back to the full-screen product.
- **Keep changing** → the customer types another request; it accumulates into the same draft version.
- **Discard** → confirm ("Throw away this change? Your live app isn't affected.") → the preview resets to the live version's code. The discarded change stays in the story history, marked discarded (nothing deleted silently).

Only one change is in progress at a time (designer's call D13); a new request while one is building is added to it ("I'll include that in this change").

**Versions panel** (from `Version 4 ▾`):

```
Versions
● Version 4  Notes for the kitchen        Live · today 14:02 · you
  Version 3  Ready column                 today 11:40 · you            [Go back]
  Version 2  QR code on each table        yesterday · you              [Go back]
  Version 1  First version                yesterday · built by Vetra   [Go back]
```

- Each version: number, title (the agent writes a short title from the change), time, who launched it, and "What changed" expandable (the agent's summary + the list of changed files; link to the GitHub commit when connected).
- **Go back** → confirm: "Make Version 2 live again? Your users' documents stay as they are. Changes made after Version 2 aren't deleted — you can come back to Version 4 any time." → launch of the older version (§7.4). The panel then shows Version 2 as live and Versions 3–4 still listed (a rollback never deletes versions).
- A rollback the data can't survive is not offered as a plain button (designer's call D6): the row says "Can't go back automatically: Version 3 added data your users have already used. Ask the agent to undo the change instead." with a button **Undo with the agent** that starts a change "Undo 'Ready column' but keep existing data".
- After a rollback, the next change starts from the live version's code (the customer's mental model: "I continue from what's live"); the newer versions remain available to go back to.

### 5.8 Agent suggestions

After each launch the agent writes 2–3 suggestions into the product document as part of its final step (no extra turn, ~no extra cost). Shown as chips in the Change drawer and once as a gentle card on the product view: **"Make it better"** · "Let guests see their order status" · "Add a daily summary for the kitchen" · "Allow allergen notes". Clicking one starts a change with that text (editable before sending). Suggestions are concrete, small (one change each), and never re-suggest a discarded idea.

### 5.9 Failure states (what the customer sees)

Every failure: strip step shows `!` or `✕`, the story has a line with a plain reason and actions. All are logged at error level for us (Foundation G7).

| Situation | Strip | Story line / UI | Actions |
|---|---|---|---|
| Model/provider error, retried successfully | unchanged | "⟲ retried once on a backup model" (small) | — |
| Turn failed after retries | active step `✕` | "Stopped: the AI service didn't respond. Nothing you built is lost." | **Retry** · **Continue** (send a message) |
| Agent loops without progress (no milestone for 5 min **(guess)**, or same failing check 3×) | `!` | "I'm stuck on the kitchen-queue drag-and-drop. I tried 3 ways." + what it tried, one line each | **Try a simpler version** · **Skip this part** · **Tell me how** (steer) |
| Step cap reached mid-build | unchanged | "Taking a breather — continuing." (agent auto-continues once; second time it asks) | **Continue** |
| Budget at 80% | budget amber | "You've used 80% of this month's budget." | — |
| Budget used up | budget red, active step `!` | "Budget used up. Your work so far is saved." | **Request more budget** (Foundation) |
| Message not picked up in 60 s | — | under the message: "Not delivered yet" | **Retry** (Foundation G4) |
| Preview won't start (60 s) | Editors `!` | "The preview is taking longer than usual." | **Restart preview** |
| Checks keep failing (agent gave up) | Tests `✕` | "2 checks still fail: …" (plain) | **Let the agent try again** · **Go live anyway** (only for lint warnings, never type/test failures) |
| Publish permission missing/expired | Live `!` | "Your Studio needs your OK to publish." | **Allow** (one Renown confirmation) |
| Launch failed (publish or rollout) | Live `✕` | "Couldn't go live: the new version didn't start. Your live app is still on Version 3." + one-line reason | **Try again** · **Ask the agent to fix it** (agent gets the logs) |
| Live app unhealthy later | `● Live` turns amber | banner: "Your live app isn't responding. We've been notified." | **Restart** · **Go back to Version N-1** |
| Rollback not possible (data) | — | see §5.7 | **Undo with the agent** |
| GitHub not connected | — | "Deployed 2 min ago · Code saved in your Studio · Connect GitHub" | **Connect GitHub** (never blocks) |
| GitHub disconnected/revoked | — | "GitHub disconnected — your code is still saved in the Studio." | **Reconnect** |
| GitHub push failed | — | "Couldn't save to GitHub (reason). Will retry with the next launch." | **Retry now** |
| Signed out / session expired | — | sign-in modal over the page; page state kept | **Sign in** |
| Studio restarting (upgrade/OOM) | all steps keep last state | "Your Studio is restarting — back in a moment." then the agent resumes (Foundation F2) | — |
| Two tabs open | — | both stay in sync (same documents); the steer box works in both | — |

---

## 6. Project and version model

### 6.1 Words

- **Product** — the thing the customer is building. One per Studio (D2). Has a name, an idea, a live address, a history.
- **Change** — one unit of work on the product, from first idea or "Change something" to launched or discarded. Each change has its own conversation (chat session), so contexts stay small.
- **Version** — a launched change. Numbered 1, 2, 3… per product. Immutable: code snapshot (git tag) + published package versions + launch record.
- **Preview** — the Studio's running copy of the product's current code (the draft), with sample data. Lives inside the Studio.
- **Live** — the product's public environment, running exactly one version at a time.

### 6.2 Where things live (designer's call D4)

| What | Where | Why |
|---|---|---|
| Product name, idea, live address, plan steps + status, changes, versions (title, summary, number, git tag, package versions, launch id, status), suggestions | **New document model `vetra/studio-product`**, one document in the Studio drive (legacy signature policy, like other Studio-drive documents, Ruling R17) | Syncs to the browser like everything else; the agent writes it with normal tools; history is inspectable; works offline from the cloud |
| Conversation of each change | existing `chat-session` documents, linked from the product document's change entry | unchanged chat framework (Foundation F2/F4) |
| Code and its history | the Studio workspace as a **git repository** (durable volume); every version = a commit + tag `v<N>` on `main`; drafts on the working tree | git is already used for pushes; tags give "go back to the code of version N" |
| Copy of the code off the Studio | the customer's **GitHub repo**, mirrored on every launch (when connected) | backup + the customer owns their code |
| What's live, launch records, rollback | **cloud: `vetra-apps` App + AppDeployments** (already has production env, deployment history, statuses, `rollbackApp`) | source of truth for "what runs"; works when the browser is closed |
| The live environment | a `vetra-cloud-environment` document (the App's production environment), Connect + Switchboard, Connect at the apex (`apexService = CONNECT`) so `<slug>.vetra.io` opens the product | existing env pipeline (Argo etc.) unchanged |
| Published code | the packages in the registry the stack installs from (`registry.vetra.io`), one package version per launch | registry versions are immutable → rollback is exact |

The product document is the UI's single read model for the strip, story chapters and Versions list. Where it and the cloud disagree about what's live (e.g. a launch finished while the Studio was down), the cloud wins and the Studio reconciles the document on load.

### 6.3 How the strip gets its truth

Today the active phase is guessed from which tool the agent called last (`useActivePhase`). That can't drive a strip people trust. New:

- The agent gets a small **progress tool** (e.g. `product-progress`): `plan(steps)`, `start(step, label)`, `count(step, done, total)`, `done(step)`, `back(step, reason)`, `milestone(text)`, `stuck(reason, tried[])`, `suggest(items)`. Each call is one operation on the product document. Cost: ~10–20 small calls per build.
- Gates stay where the workflow already has them (generate clean, preview renders, checks pass); the tool refuses `done` for a step whose gate isn't met (e.g. `done(Tests)` without a passing check run in this change), so the strip can't lie.
- Mapping to today's agent phases: Plan = product specs (+ choose name); Data = Bootstrap + Model; Editors = Editor + Preview + App; Tests = checks + reducer tests + preview smoke; Live = launch (§7).

### 6.4 Per-phase tools (decided: in this project)

Tool schemas are ≈88% of the agent's fixed context (Foundation Task 8) and a full build needs 80+ steps (staging E2E). The strip introduces explicit phases anyway, so the same signal restricts the tools the agent sees: Plan sees spec tools; Data sees project + model tools; Editors sees editor/app/preview tools; Tests sees check tools; Live sees no deploy tools at all (launch is automatic). A small always-on set (read, progress, skill, ask) stays. Expected: fewer steps (fewer wrong-tool detours), smaller prompts, faster first preview. G10 is the check. The builder measures before/after on the standard prompts (Foundation's Task 8 method).

### 6.5 Launch, preview and rollback mapped onto the cloud

Designer's call D1: **the Studio launches directly through the cloud; GitHub is a mirror, not the deploy engine.** The existing GitHub Actions path (`vetra-deploy-action`) stays for developer-managed Apps but is not used for Studio products. Reasons: Live must work without GitHub (G5); CI adds minutes, uses the customer's Actions minutes, and needs an App identity that expires (CI silently stops deploying) — all things the customer would have to understand.

Launch of version N (server-side, can run with the browser closed):

1. **Snapshot** — the Studio commits the working tree on `main`, tags `v<N>`; records sha.
2. **Publish** — the Studio publishes each package in the workspace at a new version (one per launch; e.g. `0.N.0` **(guess at scheme)**) to the stack registry. Registry versions are immutable.
3. **Deploy** — the Studio calls a new `vetra-apps` operation (working name `launchStudioVersion(appId, sha, gitTag, packages)`) authorised by the Studio's agent identity that the owner allowed (§5.3), which records an `AppDeployment` (kind PRODUCTION) and runs the existing `performDeploy` (set package versions on the production env, approve). The cloud's watcher moves the deployment PENDING → DEPLOYING → READY/FAILED as today.
4. **Verify** — READY plus an HTTP check of the live URL. FAILED → §5.9 "Couldn't go live"; the env keeps the previous package versions (the builder verifies the env pipeline does not leave a half-applied state; if it can, the launch automatically re-applies the previous version).
5. **Mirror** — push `main` + tag to GitHub if connected (failure doesn't fail the launch).
6. **Record** — the product document gets Version N with the deployment id; suggestions are written.

First launch also creates the App (repo optional, §8) and the production environment. Designer's call D8: create the App + production environment when the plan is done (minute ~1), not at the end, so the environment is up by the time Tests pass; an App never launched is cleaned up after 14 days **(guess)**.

**Preview.** The Studio's own preview server (already there) is the preview copy. No cloud preview environment per change in P2/P3 (the `PREVIEW` kind and PR previews remain for developer Apps). Consequence: previews show sample data, not live data, and can only be seen inside the Studio. This is enough for "preview next to live" for one person; shareable previews are P6.

**Rollback** = `rollbackApp(deploymentId)` (exists: re-deploys a READY deployment's packages to production), extended to Studio launches; plus the product document marks which version is live; plus the Studio resets its working tree to the target tag on a branch so the next change starts from what's live (the newer commits stay reachable by their tags).

**Data compatibility gate** (designer's call D6, MVP-blocker for G7):

- At launch: compare each document model's state schema and operations in version N with the live version. Additive changes (new optional fields, new operations, new models) launch normally. Anything else (removed/renamed fields or operations, changed types, new required fields without default) blocks Make it live with a plain explanation, and the agent is told to make the change additive (or use the Powerhouse model-versioning upgrade path where it is supported; the builder checks what the 6.2.3 train supports).
- At rollback: going back from N to M is offered only if no live document uses something M doesn't know (operations or model versions introduced after M). The check needs a cheap query against the live switchboard ("which operation types exist for model X since timestamp T") — the builder finds the cheapest honest source. Otherwise "Undo with the agent" (§5.7).
- Rollback never rewrites or deletes documents. Ever.

### 6.6 Existing Studios (G11)

On first open with the new experience:

- If the workspace has reactor projects: create the product document from what exists — name from the drive name, steps ✓ for existing models/editors/app, Tests ○ (the agent runs checks on the next change), Live from the cloud: if an env (not the Studio's own) has the workspace's packages installed, show that as "Live (set up before versions)" with no Version 1 yet; the next launch becomes Version 1 and moves that env under an App (adopting it) **or** keeps launching into it — the builder picks the safest adoption path; the old env is never deleted automatically.
- Old chat sessions become chapters under "Before versions".
- Several reactor projects in one workspace: they ship together as one product (all packages in one launch).
- The old IDEATE/SPECIFY/BUILD/DEPLOY views are not deleted: their document views are reused as the strip-step detail views; the deploy/environment management moves to Settings › Advanced.
- Existing `vetra-github-auth` connections (one repo per Studio) are carried over (§8).
- Nothing is migrated silently that could break: the upgrade only *adds* the product document and git tags.

### 6.7 What is automatic

| Automatic | Needs one click | Never automatic |
|---|---|---|
| first conversation, product document, name | Make it live (every launch after the first) | deleting anything (versions, envs, repos, documents) |
| plan → data → editors → tests | Go back (rollback) | breaking data changes (blocked, §6.5) |
| first launch when checks pass | Connect GitHub (once) | spending beyond the budget |
| App + production env creation | Allow publishing (once, renew when expired) | moving the code between GitHub accounts |
| GitHub mirror on launch (when connected) | Discard a change | |
| suggestions after launch | | |

---

## 7. Server-side flow summary (for the builder)

```
Browser (Studio page) ──reads── product doc + chat docs (Studio drive, synced)
        │ idea / steer / Make it live / Go back
        ▼
Studio agent (vetra-cli) ── writes ── product doc, chat docs, workspace git
        │ publish packages                    │ push (mirror)
        ▼                                     ▼
registry.vetra.io                          GitHub (customer repo, personal or org)
        │
        │ launchStudioVersion / rollbackApp (agent identity, owner-allowed)
        ▼
vetra-apps (cloud) ── App, AppDeployments, watcher ── production env doc ── env pipeline (Argo)
        │                                                                         │
        └────────────────── status (READY/FAILED) ◄────────── live app at <slug>.vetra.io
```

Launch and rollback run in the Studio agent process and the cloud, never in the browser, so a closed tab doesn't stop them (§5.5). The browser only signs what must be signed by the owner in person (the one-time "Allow publishing").

---

## 8. GitHub

Designer's call D14: **one GitHub connection per customer, made at most once, never on the critical path.**

- **When asked:** never before the first launch. After the first launch, the product view's status line says "Code saved in your Studio · **Connect GitHub**", and the Live step detail explains in one sentence: "Keep a copy of your code in your own GitHub account. Every launch becomes a commit you can see." Connecting is optional; nothing else changes.
- **One app, not two.** Today there are two GitHub Apps: the Studio's (`vetra-github-auth`, device flow, push tokens, personal repo per Studio) and *Vetra Deploy* (`vetra-apps`, installations, `createStudioApp`, behind a vetra.io feature flag). The customer must see one. The builder consolidates on one of them (recommendation: the installation-based Deploy app, because installations can live on organisations and it already backs Apps; the Studio mints push tokens from the same installation). Existing Studio connections are migrated or keep working until migrated — no customer action needed.
- **Server-side.** The connection flow can be a GitHub install/authorise redirect or the device flow — whichever needs fewer steps from inside the Studio; the token handling stays server-side (no tokens in the browser or in the workspace beyond short-lived push tokens, as today).
- **Personal and organisation accounts (G9).** When connecting, the customer picks where the code goes: their account or any organisation where the app is installed (the list comes from installations). Org repos are created with the org repo API, not `/user/repos` (today's limitation in both `vetra-github-auth` and `createStudioApp`). Org policy refusals (app not allowed, repo creation restricted to owners) show the Foundation G5 error codes in plain words with the next step ("Ask an owner of web3-berlin to allow Vetra, or choose your personal account").
- **Repo:** private, named after the product slug (taken → suffix), description "<name> — built with Vetra Studio". Existing history is pushed in full on connect (all version tags).
- **Edits made on GitHub** (someone pushes to `main`): designer's call D15 — the Studio detects it (webhook already exists) and shows "There are changes on GitHub that aren't in your Studio" with **Bring them in** (the agent merges them into the next change). They are never launched automatically. No CI deploy workflow is committed for Studio products (the existing workflow template remains for developer Apps).
- **Disconnect/revoke/delete repo:** status line shows it, nothing is blocked, history stays in the Studio's git.

---

## 9. Constraints carried from Foundation

- **Staging first, then prod**, for every service, image and Studio release; pin image tags only after the image exists. Prod rollout of the new experience happens only after the full staging E2E (G2–G9) passes.
- **Version alignment before anything else:** staging today runs switchboard `v6.2.3-dev.45` while the Studio client is on a newer `dev.66` train and fails with a `400 Cannot query field 'meta' on type 'PHDocument'` in the deploy view. The Studio client and the cloud switchboards must be a combination proven on staging (move staging forward — its DB migrations are forward-only — or align the client); Foundation's compatibility check in CI covers it going forward. Prod switchboard moves only forward.
- **Signatures:** cloud environment documents need v2 signatures and owner-only reducers stay owner-only; Studio-drive documents (product, chat, specs) use the legacy policy (R17). Any server-side launch path must not weaken env-document authorisation; it goes through `vetra-apps`' own authorised deploy path.
- **Existing Studios and their data survive** every change; document-model changes ship with upgrades; nothing is migrated silently.
- **Budgets:** staging default $10/Studio/month, prod default $1 until pricing is decided, demo Studio $50; 80% warning and "Request more budget" (Foundation). Measured first build: $0.06–0.15 — fits $1 for one product plus a few changes.
- **Each Studio signs in on its own stack's Renown** (staging: renown-staging; prod: www.renown.id) — R21; the preview's Renown namespace stays separate from the Studio's (the dev.6 freeze fix).
- **Agent behaviour** (R18–R20): build requests build immediately without check-in questions; one-shot mode; `maxSteps` 80 stays the cap (per-phase tools aim well under it). The deploy skill's "never create or pick an environment on the user's behalf" rule is replaced for Studio products by the automatic launch (§6.5); it remains for explicit "deploy to my existing environment X" requests in Advanced.
- **No secrets** in output, logs, commits, the product document or the browser.
- **Public repos use neutral wording** (vetra-cli is public): no security language in commits/PRs.
- **Commits:** conventional, no Co-Authored-By / "Generated with" trailers. Pushes touching `.github/workflows` go over SSH.
- **vetra.io changes go to main and staging.** The Studio card on vetra.io shows the product name, live link and status; landing copy softened by Foundation G8 ("Every step is a commit", "Data may be lost between versions") is restored/strengthened only when the matching part ships ("Every launch is a version you can go back to").
- Agent images build automatically on release; the nightly job bumps only the staging pool; the prod pool is pinned by hand.

---

## 10. Designer's calls

Each can be overridden; each line says why.

- **D1 Launch directly from the Studio through `vetra-apps`; GitHub mirrors.** Live must not depend on GitHub, Actions minutes or an expiring CI identity; the cloud already has App + deployments + rollback to build on.
- **D2 One product per Studio.** One repo, one App, one live address per Studio matches what exists (`createStudioApp` is unique per Studio; one repo per Studio) and keeps the page simple; a second product = a second Studio.
- **D3 First launch automatic, later launches one click.** The demo promise is "it ships by itself"; once real users exist, changing what they see must be the customer's decision.
- **D4 A `vetra/studio-product` document is the read model; the cloud is the truth for what's live; git is the truth for code.** Each source owns what it can guarantee; the UI reads one document.
- **D5 Keep the strip labels Plan · Data · Editors · Tests · Live.** The CEO approved them; "Editors" covers editors and app views; renaming costs alignment for little gain.
- **D6 Data-safe launches and rollbacks: block breaking changes, never rewrite data, offer "Undo with the agent" when a plain rollback would break documents.** "Losing work on rollback" is the worst possible demo moment and the worst customer outcome.
- **D7 Ask for publishing permission once, in the sign-in moment; don't block the build on it.** Removes the "Authorize agent" button from the main path without hiding a signature.
- **D8 Create the App and production environment as soon as the plan exists.** Environment start-up time overlaps with the build, so "Live" takes 1–3 min instead of 5–10.
- **D9 Time left only from measured per-phase averages; switch to "taking longer than usual" instead of going negative.** An honest estimate beats a precise-looking wrong one.
- **D10 Steering applies at the next agent step.** Steering that waits for an 80-step turn to end isn't steering.
- **D11 "Tests" includes a preview smoke render.** Customers equate "tests passed" with "it works".
- **D12 The live product fills the page embedded, with a fallback to the version's preview.** The page should show the product, not a link to it; embedding can fail on auth/frame rules.
- **D13 One change in progress at a time.** Parallel drafts need merging and multiple previews; nobody asked for it.
- **D14 One GitHub connection, optional, after the first launch; personal and org.** GitHub is valuable but must never stand between the idea and the URL.
- **D15 Changes pushed on GitHub are brought in through the agent, never auto-launched; no CI deploy workflow in Studio repos.** One writer to Live avoids two deploy paths racing.
- **D16 Per-phase tool filtering ships in this project.** The strip creates the phase signal; it's the biggest lever on steps, cost and time (G10).
- **D17 Each change is its own conversation; the story shows them as chapters.** Smaller context per change (cheaper, faster), and history reads as product history.
- **D18 Previews show sample data only.** Copying live data into a preview raises privacy and size questions that belong to a later project.
- **D19 The live address is fixed at first launch (slug of the name); renaming the product doesn't change it.** Links people already shared must keep working.

## 11. Open questions for the CEO (only these change what gets built)

1. **Where does the code live before the customer connects GitHub?** Default (D14): in the Studio only (git on the Studio's disk, plus the published packages), GitHub when they connect. Alternative: every product gets a private repo in a Vetra-owned GitHub organisation from the first build, transferable to the customer later — "GitHub ✓" from minute one, but we hold customer code.
2. **Is a live product included in the Studio, or does going live need a paid plan?** Default: included (one live environment per Studio), within the existing budget limits. If it needs a plan, a payment step sits in front of the first launch and the "ships by itself" demo needs a pre-paid demo account.
3. **Who can use the live product?** Default: anyone with the link can open it and sign in with Renown. Alternative: only the owner (and later invited people, P6) — then the demo shows the product, but investors can't try it on their phones.

## 12. Inventory: what exists vs what the vision needs

Legend: ✅ exists and reusable · 🟡 exists, needs change · ❌ missing. **B** = MVP blocker for the demo sentence, **P** = polish (can follow).

| Area | State today | Needed | |
|---|---|---|---|
| Chat that never dead-ends, retries, resume, delivery receipts | ✅ Foundation F2/F4 (ph-clint) | reuse; render as story | — |
| Budget meter, 80% warning, Request more budget | ✅ Foundation F3 | move into strip | P |
| Studio page layout | 🟡 chat pane + 4 tabbed sections + PhaseCycle home + Auto-follow toggle (`VetraStudio.tsx`) | replace with strip + two states | **B** |
| Phase detection | 🟡 guessed from last tool call (`useActivePhase`, `auto-nav.ts`) | progress tool + product document | **B** |
| Product / project / version model | ❌ projects = drive folders (`specify/projects.ts`); no versions | `vetra/studio-product` document | **B** |
| First conversation | ❌ must be created by hand ("+ New session") | created from the idea | **B** |
| Story rendering | 🟡 raw tool-call transcript (tool-renderers) | milestones + folded detail | **B** |
| Steer during a build | 🟡 messages queue for the next turn **(guess; verify)** | read at next step | **B** |
| Live preview | ✅ BUILD pane, preview server, hot reload, sample data | tabs per editor, skeleton states | P |
| Checks/tests | 🟡 `reactor-project-check`, reducer tests in modeling skill | gated Tests step + smoke render | **B** |
| Per-phase tools | ❌ all tools every step; 80+ steps per build | phase-scoped tool sets | **B** (cost/time) |
| Time-left estimate | ❌ | per-phase averages from staging runs | P |
| Deploy from Studio | 🟡 browser-signed publish + install into an env the user picks (`deployProject.ts`); needs open tab, user picks env | server-side launch via vetra-apps | **B** |
| App, deployments, rollback | ✅ `vetra-apps` (App, AppDeployment, watcher, `rollbackApp`, `createStudioApp`) — not used by the Studio; "Make it an App" behind a vetra.io flag | Studio launch mutation; Studio-originated deployments | **B** |
| Production env + apex URL | ✅ env pipeline, `apexService`, `envUrls` | Connect at apex for Studio products | **B** |
| Data compatibility gate | ❌ | schema/ops diff at launch; usage check at rollback | **B** |
| Versions panel, Go back | ❌ | UI + rollback wiring | **B** |
| Change → preview → Make it live split view | ❌ | UI + git working tree vs tags | **B** |
| Agent suggestions | ❌ | `suggest` progress op + chips | P (strong demo value) |
| Publishing permission | 🟡 "Authorize agent" button in the top bar | one prompt at sign-in, renew banner | **B** |
| GitHub connection | 🟡 two apps; personal only; one repo per Studio; device flow works on staging (repo in 33 s) | one connection; org repos; mirror on launch; migration of existing | **B** for one-app + no-block, P for org (G9 still in scope) |
| Edits on GitHub brought in | 🟡 webhook exists (`vetra-apps/webhook.ts`) | detect + agent merge | P |
| Version alignment (client vs staging switchboard `meta` 400) | ❌ broken on staging | aligned train | **B** (prerequisite) |
| vetra.io Studio card (name, live link, status) | 🟡 shows Studio + budget | product status | P |
| "1 document type couldn't load" banner in Studio | ❌ seen on staging | fix or hide | **B** (demo) |
| vetra.to Studio link passes `did:key` as `?user=` ("Invalid pkh did"); 2 queries missing on staging switchboard | ❌ seen on staging | verify the entry path used in the demo | **B** if on the demo path |
| Product tour, LearnWhileYouWait | ✅ | removed from the main path (story replaces it); tour → P5 | P |
| Studio pod readiness probe; dead-lettered messages | ❌ Foundation follow-ups | — | P |

## 13. Left to the builder

- The exact `vetra/studio-product` schema and operations (shape in §6.2; follow the repo's document-model rules: MCP-first, errors, ≥95% reducer coverage).
- Progress-tool API names and how gates are enforced.
- How steering reaches the running agent (between-step hook vs abort-and-continue with Foundation's checkpointing).
- The launch mutation's name, auth model (agent identity allowed by the owner vs. a Studio-scoped token) and how it reuses `performDeploy`/watcher; whether Studio launches reuse the Apps table or a sibling.
- Package version scheme per launch; git tag naming; what the Studio does with an existing env when adopting (§6.6).
- The data-compatibility checks' implementation and the cheapest source for "which operations are used on live".
- Which GitHub app survives the consolidation, and the migration of existing connections.
- Health-check details, embed fallback detection, stuck-detection thresholds, time-left averages.
- Visual design within the layout and copy given here (spacing, motion, colours as design tokens, dark mode). Follow the mockup `hybrid.html`.

## 14. Delivery outline

Each milestone ships to staging, is demoable on its own, and leaves existing Studios working. Prod only after M5's full staging pass.

- **M0 — Ground.** Align the Studio client and staging switchboard train (fix the `meta` 400); per-phase tool sets; progress tool + `vetra/studio-product` document written by the agent (shown in a temporary debug panel); first conversation created automatically. *Demo:* same standard build in noticeably fewer steps, with clean milestones in the product document; step count and cost recorded.
- **M1 — Story while it builds.** New page: blank idea screen, strip with real step states, story with folded detail, steer box that applies mid-build, preview with tabs and skeletons, Tests step with smoke render, failure states for build-time problems, budget + time left on the strip. Old sections reachable as step details. *Demo:* idea → working preview on one screen, steering once mid-build.
- **M2 — Ships by itself.** Publishing permission at sign-in; App + production env created when the plan exists; server-side launch through `vetra-apps`; Connect at the apex; automatic first launch; product view (state 2) with embedded live app; launch failure states. GitHub not required. *Demo:* idea → live URL on a phone, in one sitting, without touching GitHub.
- **M3 — Change safely.** Change something drawer, Live | Preview split, Make it live / Keep changing / Discard, Versions panel, Go back, data-compatibility gate at launch and rollback, "Undo with the agent", agent suggestions. *Demo:* add a feature, launch it, use the live app, go back a version, data intact.
- **M4 — GitHub without thinking.** One GitHub connection (consolidated app), optional after first launch, personal and org repos, mirror + tags on every launch, full history on connect, existing connections migrated, "bring in changes from GitHub". vetra.io Studio card shows product status (main + staging). *Demo:* connect `web3-berlin`, see the version tags in the org repo.
- **M5 — Existing Studios and demo hardening.** Upgrade path for existing Studios (§6.6) tested on copies of `rapid-fox` and `vivid-slug`; staging E2E for G2–G11 run 5× green; landing copy restored where now true (vetra.io main + staging); then prod rollout (switchboard forward, prod pool pinned, demo Studio upgraded and given its $50 budget). *Demo:* the investor script on prod: idea → live → change → launch → go back.
