# Project 6 — Teams

**Status:** approved scope (Frank, 2026-10-21: all twelve ideas, "go ahead") · draft design for planning
**Builds on:** Projects 2+3 (story, changes, versions, Go back, launch), Project 4 (`2026-10-21-iterate-design-design.md`: Point and change, notes from live, Remix/Compose, theme, story layers), Project 5 (`2026-10-21-first-minutes-workshop-design.md`: workshop mode, room link, per-user language).

## 1. Intent

Until now a Studio is one person's: one owner, one agent acting for them, one change at a time. Real customers — DTBau, agencies, ops teams — are groups. Project 6 makes a Studio the place where **a team builds and runs its tools together, provably**: several people work at once without stepping on each other, talk about the product where it is, approve what goes live, and share what they've built across their organisation.

Frank (2026-10-21): "slowly that gets a real experience." The story across projects: build alone (2+3) → shape it with your hands (4) → run a workshop (5) → work as a team (6).

**Success:** three people from one org use one Studio on a normal day — each on their own change, commenting on each other's work in the preview, one reviewer approving Version N, the agent asking the right person — and the org's audit export shows who asked for, built, approved and launched every version.

## 2. Goals — what "done" means

| # | Goal | Done when |
|---|------|-----------|
| T1 | **Org Studios and roles** | A Studio can be owned by a Renown organisation (the existing `renown-organization` document) instead of a person. Members have roles **Owner** (members, budget, settings, delete), **Maker** (start/steer changes, Make it live if no review is required), **Reviewer** (approve going live), **Viewer** (watch, comment). Every action is signed by the acting person; the agent acts on the org's delegation and records on whose request. A personal Studio can be moved into an org. Org-owned live environments are listed and adoptable (closes the 3.7 gap). |
| T2 | **Own change each** | Several changes can be open at once, one per person (or more); each has its own chat, preview, story and git branch from the current version. A **changes board** shows open changes (who, what, state: building / ready / needs review / conflicts) and what goes into the next version. Combining changes into a version merges branches; conflicts are resolved by the agent and explained in plain words, with a person confirming. |
| T3 | **Presence** | Avatars show who is in the Studio and which change/view they're in; in Point mode each person's pointer and selection is visible to others in the same preview; **Follow** mirrors someone's view; **Pass the wheel** hands the driver role (workshop mode) to another member. |
| T4 | **Anchored comments** | Comments attach to a story line, a preview element (via Point), a version, a document field or a change; threads with replies, @mentions, resolve. **@agent** in a thread turns it into a change request (or adds it to the open change) with the thread as context. |
| T5 | **Signed review before live** | Per Studio setting "Going live needs a review" (default on for org Studios): Make it live becomes "Ask for review"; a Reviewer approves (Renown-signed) or requests changes; each change has a stakeholder preview link (Project 5 room-link mechanism, read-only). The version history shows who approved and when. |
| T6 | **Team brain** | An org-level "How we work" document: glossary (terms, preferred words), brand (P4 theme at org level, default for new products), rules ("dates DD.MM.YYYY", "every defect needs a photo"), people and their responsibilities. Every org Studio's agent follows it; when a decision belongs to a responsibility, the agent asks that person (@mention) instead of the room or the requester. |
| T7 | **Org library** | Packages published from an org's Studios can be marked **org-private**: visible and installable only for that org's members and Studios (registry access by Renown org membership). The P4 Remix/Compose browser shows the org library next to public packages. This is where DTBau-like private packages live. |
| T8 | **Shared budget** | One budget pool per org, optional per-member limits, cost attributed per change and per person; Owners see a breakdown; "Request more budget" goes to the org Owner first. |
| T9 | **Stay in the loop** | Notifications per person (in-Studio, email; Slack / Microsoft Teams via incoming webhook per org): review requested, version live, mention, user notes, budget near limit. A daily digest across the org's Studios. "While you were away" (P4) is per person and includes others' changes. |
| T10 | **Triage** | Notes from the live product (P4) and comments tagged as requests land on a triage board; a member with the Triage responsibility turns each into a change, assigns it to a person **or to the agent** (agent starts the change and asks for review when done), or dismisses it. |
| T11 | **Outside guests** | Invite a person from outside the org (any Renown identity) into **one change** with a time limit and limited rights (comment, or comment + steer), revocable; access ends automatically; everything they do is signed and attributed. |
| T12 | **Audit trail** | An org timeline of signed events (requested, built, reviewed, approved, launched, rolled back, member/role changes) across Studios, filterable, exportable (CSV + signed JSON with operation signatures) for compliance. |

**Acceptance (demo script):** org "Acme Bau" with three members (Owner, Maker, Reviewer) + one guest. Maker A and Maker B each open a change in one Studio; B comments on A's preview element; @agent applies it; changes conflict and are combined by the agent; A asks for review; Reviewer approves; version goes live; a user note arrives, triage assigns it to the agent; the agent's change gets reviewed; Slack receives the notifications; audit export shows every step signed. On staging, then prod.

## 3. Non-goals

- Real-time co-editing of the same text/chat box (Google-Docs style). Presence and comments, yes; two people typing into one change's steer box at once, no — one person steers a change at a time (others comment).
- Enterprise SSO/SCIM, external identity providers beyond Renown (later).
- Per-document permissions inside the live product (the product's own access model stays as Projects 2+3 set it).
- Billing/invoicing changes beyond attributing and pooling the existing budgets.
- Cross-org shared Studios (guests cover the cross-org case).

**Anti-goals:** a team member's change silently overwrites another's; an approval that isn't provably signed by the approver; a private org package visible outside the org; notification spam (defaults must be quiet — mentions, reviews and failures only).

## 4. Constraints

- Identity and signing stay Renown; organisations are the existing `renown-organization` document; membership and roles live there or in a Vetra-side document linked to it (builder's call, recorded as a ruling). Prefer the existing org document; don't invent a second org concept.
- Every operation stays signed (v2 signatures) by the acting person; the agent's operations carry the requesting member.
- Owner-only preview-server routes (S1) generalise to **member + role** checks with the same Studio-bound token (aud) design; Viewer/guest routes are explicitly listed and minimal.
- Studio-per-org pool claims require an org licence path (current claim checks a personal licence — `vetra-studio-pool` claim); extend, don't fork.
- Staging first, then prod; registry.vetra.io only; neutral wording in public repos; per-user language (P5).
- Multiple open changes share one Studio pod: concurrent builds must respect the pod's resources (queue or limit concurrent agent runs; builder decides from measurements; target: two changes building at once).

## 5. Notes on the hard parts (designer's calls)

- **Concurrent changes:** each change = git branch `change/<id>` from the current version; previews per change share one dev server switched per viewer if two can't run at once (as P4 variants); the product document already models one open change — extend it to a list with an owner per change (additive schema change, codegen). Combining = sequential merges in board order; the agent resolves conflicts inside a "combine" change visible on the board.
- **Agent identity:** the Studio agent signs with an org-delegated key; every agent operation records `onBehalfOf` (member address). Revoking a member stops their pending agent work.
- **Comments:** stored as documents in the Studio drive (one thread per document), anchors reference story line id / version / document id+field / a Point selector + screenshot.
- **Org-private packages:** registry access by Renown org membership (the registry already authenticates Renown bearers for publish); read access for org-private scopes (e.g. `@vetra-apps-org/<org>/…` or a per-package flag — builder's call) checked the same way. Live environments of that org get a read credential.
- **Notifications:** in-Studio + email via the cloud; Slack/Teams via per-org incoming-webhook URLs stored as org settings (secrets never shown again after entry).
- **Audit export:** built from the signed operations of the product documents, org document and environment documents; the signed JSON lets anyone verify signatures offline.

## 6. Milestones (suggested)

1. **P6-M1 Org Studios + roles + org agent identity** (T1) — foundation for everything.
2. **P6-M2 Own change each + board + combine** (T2).
3. **P6-M3 Comments + @agent** (T4).
4. **P6-M4 Review before live + stakeholder links** (T5).
5. **P6-M5 Presence, follow, pass the wheel** (T3).
6. **P6-M6 Notifications + digest** (T9) and **Triage** (T10).
7. **P6-M7 Team brain** (T6).
8. **P6-M8 Org library** (T7) and **shared budget** (T8).
9. **P6-M9 Guests** (T11) and **audit export** (T12).
10. **P6-M10 Demo** — the acceptance script, staging then prod.

Every milestone is a cut line.

## 7. Left to the builder
Exact role/permission matrix details beyond §2; where membership lives (org document vs linked Vetra document); board visuals; presence transport (switchboard subscriptions vs a small websocket in the Studio pod); comment schema; notification templates; digest timing; registry scope naming; audit CSV columns. Recorded as rulings.

## 7a. Designer's calls from the builder check

- **Roles come from the org.** Org-wide mapping from `renown-organization` roles: OWNER/ADMIN → Owner, PUBLISHER → Maker, MEMBER → Viewer. **Reviewer** is assigned per Studio (a small Vetra-side Studio membership document linked to the org, also holding per-Studio overrides). No second org concept.
- **What is approved:** the exact version candidate that goes live (after combining changes), identified by its git sha and package versions. Anything changed after approval voids it; the board shows "needs review again".
- **No self-approval:** the requester of a change can't approve a version that contains it (four-eyes). An Owner can turn "Going live needs a review" off per Studio; that setting change is itself an audited event.
- **Agent signing:** the agent signs with the **requesting member's own delegation** to the Studio's app key (the existing one-time "Allow" permission, Projects 2+3 Task 2.8, now per member). Members who haven't allowed are asked on their first agent request. Removing or suspending a member suspends their delegation; their pending agent work stops and shows "paused — <name> no longer has access".
- **Adopting org-owned live environments:** Owners only, into an org Studio of the same org.

**Status:** approved for planning (Frank: "go ahead"; Q1 default in force).

## 8. Open questions for Frank

- **Q1 — decided (Frank, 2026-10-21: "org licence is fine"). Who holds the licence and pays for an org Studio?** Today a Studio needs a personal `app-owner-license` (pool claim checks it; the LLM key and budget hang off it). *Default if unanswered:* a new **org licence** (bought through Achra like the personal one) lets an org claim Studios; the shared budget pool hangs off the org licence; moving a personal Studio into an org requires the org licence and moves the Studio's remaining budget into the pool; members need no licence of their own.
