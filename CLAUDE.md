# vetra-cli — agent instructions

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
- **`HANDOFF.md`** — you may edit freely without asking, but at the end
  of the turn tell the user what you changed (a short summary: which
  sections, what was added / removed / reworded). The user needs to know
  the doc moved.
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
them locally; rebuilds in any of the three are picked up on next
vetra-cli start.

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

## Ground rules (from `HANDOFF.md`, repeated here so they're loaded)

- No historical narration in code comments ("was previously…", "used
  to…", "swap from X to Y…"). Comments describe the code now.
- No marketing/buzzword phrasing in code or docs.
- No emoji in code, comments, file content, or commit messages unless
  explicitly asked.
- Don't pre-emptively wrap up. End-of-turn summaries are 1–2 sentences.
- Commits follow concern, not size. Don't lump cross-repo changes.
