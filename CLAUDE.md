# vetra — agent instructions

This directory holds three durable documents that together carry the project
state across sessions. Read them in this order at the start of any
non-trivial session:

1. **`ARCHITECTURE.md`** — the durable map of how the pieces fit together
   (embedded reactor, Switchboard, Connect, local-registry, triggers,
   services, publish flow, dynamic package loading). Update it when the
   shape of the system changes, not when day-to-day work happens.

2. **`HANDOFF.md`** — the rolling state of in-progress work on the
   publish-pipeline / dynamic-load chain. Treat it as a long-running thread
   shared across sessions: it records decisions, files changed, known
   issues, test plans, and open gaps. **Keep it current.** When you finish a
   chunk of work, update the relevant sections (Architecture decisions,
   Files changed, Known issues, Things NOT done, Suggested next steps) so
   the next session can pick up cold. Honor the "Ground rules" section at
   the top — it captures durable preferences from the user.

3. **`TODO.md`** — short backlog of follow-ups and migrations that aren't
   yet scheduled. Promote items into HANDOFF when active.

## Updating the docs

- **`TODO.md`** — when you notice something worth tracking (a follow-up,
  a migration, a quick-fix idea), suggest it to the user and ask for
  confirmation before adding it. Don't write to `TODO.md` unprompted.
- **`HANDOFF.md`** — tracks the in-progress publish-pipeline / dynamic-load
  thread specifically. Only update it when the work you just did materially
  shifts that thread: a decision changed, a known issue was resolved or newly
  discovered, a "Things NOT done" item flipped state, a file in the publish /
  reactor / Switchboard / Connect / triggers / registry chain changed in a way
  the next session needs to know. Do **not** log routine work, prompt
  tweaks, tool-description edits, agent-session reviews, or anything
  unrelated to the publish-pipeline thread — those go in commit messages or
  stay in the conversation. When in doubt, ask. When you do update, tell the
  user at end-of-turn which sections moved.
- **`ARCHITECTURE.md`** — update in the same commit as the code change
  that shifted the architecture.

## When to use what

- **Full session on the publish pipeline or anything touching the
  reactor / Switchboard / Connect / triggers / registry** → read all
  three.
- **Short parallel session for a quick fix** (typo, isolated bug, small
  refactor in a spec command, etc.) → skip the three docs unless the
  change clearly intersects with the publish flow. If you discover the
  fix is bigger than expected, stop and read them.
- **Architectural change** → update `ARCHITECTURE.md` in the same
  commit as the code change.
- **Work in progress that won't finish this session** → leave a note in
  `HANDOFF.md` so the next session starts with context.

## Cross-repo context

The runtime composition spans three checkouts (vetra-cli, ph-clint,
monorepo worktree at `apps/switchboard` + `apps/connect`). See
`ARCHITECTURE.md` → "Repositories" and `HANDOFF.md` → "Repositories
touched" for paths. Workspace overrides in `pnpm-workspace.yaml` link
them locally; rebuilds in any of the three are only picked up after the
dev daemon is cycled — see "Dev daemon model & rebuilds" below.

## Dev daemon model & rebuilds

When you run `pnpm dev` interactively, `main.ts` is the **foreground
REPL** (reactor + Switchboard) and dies on Ctrl+C. But it spawns the
`vetra-studio` service (a `ph vetra` process group serving the
Switchboard + Connect Studio BUILD preview from `vetra-app/dist/connect`)
as a **detached service that survives the REPL.** On exit you'll see:

```
vetra-studio still active …
Run `vetra vetra-studio-stop` to shut it down
```

A subsequent `pnpm dev` **reuses** that still-running service rather than
restarting it — so **rebuilds do not take effect until the service is
cycled.** This is the #1 source of "I fixed it but nothing changed."

ph-clint manages the service lifecycle (tracked PID, clean process-group
kill). After rebuilding linked packages or `vetra-app/dist`, stop the
service with the built-in before re-running `pnpm dev`:

```
vetra vetra-studio-stop          # built (dist) CLI
# in dev without a build:
pnpm --filter vetra exec tsx src/main.ts vetra-studio-stop
```

Don't `pkill -f` the processes — the managed `*-stop` command is the
correct mechanism and kills the whole group via the tracked PID.

Two non-obvious bundle facts that compound this:
- **`vetra-app/dist` is gitignored build output.** The browser client's
  sync query (`PollSyncEnvelopes`) is baked into
  `vetra-app/dist/connect`, **not** the node-side packages. A stale
  `dist` serves a stale query even when node_modules is correct. Rebuild
  with `pnpm --filter vetra-app build && pnpm --filter vetra-app build:connect`.
- The node-side routine poll and the browser poll are **separate code
  paths**. Verifying one does not verify the other — exercise the
  browser (load `http://localhost:8090/d/<drive-id>` and check the
  `pollSyncEnvelopes` POST) when the symptom is browser-facing.

When verifying a fix, restart the daemon, hard-load the Studio in a
browser, and confirm the actual request — don't infer from boot logs.

## Iterating: what each change needs

The reload story differs by what you edit. Match the change to the
loop before assuming something is broken — most "nothing happens" reports
are a stale artifact, not a real bug.

| You changed… | To see it |
|---|---|
| Studio UI / editors / document models (`vetra-app` source) | Nothing — `ph vetra` dev mode runs **Vite HMR**, saves live-reload in the Studio. |
| `vetra` source (`src/` — CLI, agents, triggers) | Restart the REPL: Ctrl+C, `pnpm dev`. `dev` is `tsx src/main.ts` (no build step). |
| **Agents or skills** (`src/cli.ts` `prompts.agents`, anything under `prompts/`) | **`pnpm build:assets`, then restart the REPL** — see "Generated assets" below. |
| The built Studio **BUILD preview** pane (`vetra-app/dist/connect`) | `pnpm --filter vetra-app build && build:connect`, then cycle the service. |
| A linked framework package (`clint-common` / `ph-clint`) | Rebuild it (`pnpm --filter @powerhousedao/<pkg> build`), then `vetra vetra-studio-stop && pnpm dev`. No HMR across a built-dep boundary. |

## Generated assets (`gen/`) — the silent-stale gotcha

Agent profiles and `SKILL.md` files are **generated** from `src/cli.ts`
(`prompts.agents`) + `prompts/` into `gen/` (and `dist/gen/`) by
`pnpm build:assets`. At runtime `getAgentInstructions(<id>)` reads
`gen/agent-profiles/<name>.md`; a missing file throws and the agent
never runs (e.g. a chat box that types but never replies).

**`pnpm dev` does NOT run `build:assets`** — it reads whatever `gen/`
already exists. So adding/renaming an agent or skill in `src/cli.ts`
and just running `pnpm dev` silently uses a **stale profile**. The full
root `pnpm build` *does* regenerate `gen/` (via
`vetra build` → `build:assets && tsc`), but dev does not.

After touching `prompts.agents` or `prompts/`: run `pnpm build:assets`,
then restart the REPL. (Profiles are read once at agent-definition time,
so a restart is required even after the file exists.)

### `.claude/ph-clint` symlink

`.claude/ph-clint` is a symlink to the local ph-clint checkout
(`/Users/acaldas/dev/powerhouse/ph-clint`). It's there so you can read
framework internals (services, runtime, switchboard glue, interactive
REPL, agent loader) from inside this workspace without leaving it.

Treat it as a **read-only reference**:

- Don't recursively grep/find/glob across the vetra-cli tree without
  excluding `.claude/ph-clint`. It contains a full node_modules tree,
  pnpm-lock, examples, prototypes, sandbox — searches will be slow and
  noisy. Target it explicitly when you actually need ph-clint internals.
- Don't edit through the symlink unless the task is specifically a
  cross-repo change in ph-clint, in which case commit boundaries follow
  the rule above (separate commits in separate repos).
- The Explore / general-purpose agents should be pointed at specific
  subpaths under `.claude/ph-clint/packages/...` rather than the symlink
  root.

## Authoring vetra agent skills

When editing anything under `prompts/skills-tpl/<skill>/`, use the
`vetra-skill-authoring` Claude skill — it covers sources vs generated
output, what the runtime `skill` tool actually returns, and the preamble
rules that decide whether the model drills into references.

## Ground rules (from `HANDOFF.md`, repeated here so they're loaded)
- Use terse comments.
- No historical narration in code comments ("was previously…", "used
  to…", "swap from X to Y…"). Comments describe the code now.
- Don't pre-emptively wrap up. End-of-turn summaries are 1–2 sentences.
- Commits follow concern, not size. Don't lump cross-repo changes.
