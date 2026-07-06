# Vetra CLI

**Build Powerhouse document-model apps and packages by chatting with an agent.**



---

Vetra is an **agent-driven CLI** for the [Powerhouse](https://www.powerhouse.inc/)
tech stack. Instead of hand-scaffolding boilerplate, you describe what you want
in plain language and the agent designs and generates it for you — then renders
it live in a browser editor (**Vetra Studio**) as you iterate.

You can build:

- **Document models** — state schemas, operations, and reducers.
- **Editors** — React components for editing a document type.
- **Drive-apps** — dashboards, kanban boards, and custom drive-level views.
- **Reactor packages** — initialize, build, and publish the whole thing.

## How it works

```
   you (terminal)
        │  "build a to-do document model"
        ▼
  ┌─────────────────┐      ┌──────────────────┐
  │  Vetra agent    │◄────►│ Embedded Reactor │
  │  (interactive)  │      │ (in-process DM)  │
  └────────┬────────┘      └──────────────────┘
           │ spawns + previews
           ▼
  ┌──────────────────────────────────────────┐
  │ Vetra Studio (Connect + Switchboard)       │
  │ live preview → http://localhost:8090/d/... │
  └──────────────────────────────────────────┘
```

A single `vetra` process runs the interactive REPL, an embedded Reactor, and an
embedded Switchboard. The agent spawns **Vetra Studio** — a Connect-based
browser editor — so a freshly generated document model renders live while you
iterate. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full map.

The orchestrator (`vetra-agent`) delegates to three specialists —
`agent-document-model`, `agent-editor`, and `agent-app` — each backed by skills
that run in `expert`, `discovery`, or `one-shot` mode depending on how much you
want the agent to decide on its own.

## Prerequisites

- **Node** ≥ 22.13.0
- **pnpm** 11.5.0 (`corepack enable`)
- An **Anthropic API key** (the agent runs on
Claude)
- **Docker** — only needed for the end-to-end [lab](lab/README.md)

## Run it locally

Clone the repo, install, and start the agent:

```sh
pnpm install
pnpm dev
```

> `**pnpm dev` is the local entrypoint.** It launches the interactive agent
> REPL (`tsx src/main.ts`, no build step) with the embedded Reactor and
> Switchboard. When the agent starts a build, watch the logs for
> `Vetra Studio: http://localhost:8090/d/<driveId>` and open that URL to see
> your work live.

Authenticate the agent once, either way:

```sh
# API key
export ANTHROPIC_API_KEY=sk-ant-...
```

To wipe the local dev workspace and start clean:

```sh
pnpm dev:reset
```

## Your first session

Once the REPL is up you'll see:

```
vetra v0.0.1 …
Workdir: …
Type a message to talk to the agent, or / for commands.
```

Try a build, end to end:

```
> Create a "todo-list" document model with tasks that have a title,
  a done flag, and a priority. Then generate an editor for it.
```

The agent designs the schema, generates the model and editor, and boots Vetra
Studio. Open the printed `http://localhost:8090/d/<driveId>` URL and edit your
new document type in the browser. Iterate by continuing the conversation.

Type `/` at any time to see the available slash commands (publishing, service
control, auth, and more).

## Installing the published CLI

The released CLI ships as the `vetra` binary. Install it with the one-liner —
it installs `ph-cmd` + `vetra-cli`, ensures a pinned pnpm is on PATH, and
offers to set up Claude auth:

```sh
curl -fsSL https://get.vetra.io | sh
```

Prefer to run it yourself (to read it first, or to answer the auth prompt)?

```sh
curl -fsSL https://get.vetra.io -o install.sh
sh install.sh
```

Advanced / manual install — the CLI needs both packages:

```sh
npm install -g ph-cmd vetra-cli        # or: pnpm add -g ph-cmd vetra-cli
export ANTHROPIC_API_KEY=sk-ant-...    # or run: vetra claude-login
vetra                                  # launch the agent REPL
```

`ph init` scaffolds new projects with pnpm when it's installed, else npm (set
`VETRA_PACKAGE_MANAGER` to force `npm`/`pnpm`/`yarn`/`bun`).

Installer env knobs (non-exhaustive — see the header of `install.sh`):
`VETRA_VERSION`, `PH_VERSION`, `VETRA_REGISTRY` (e.g. the pre-release registry
`https://registry.dev.vetra.io`), `VETRA_PM=npm|pnpm` (installer PM),
`VETRA_PACKAGE_MANAGER` (PM for scaffolded projects), `VETRA_SKIP_PH=1`,
`VETRA_YES=1` (non-interactive), `VETRA_NO_LAUNCH=1`.

## Project layout


| Path                               | What it is                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| [vetra-cli/](vetra-cli/)           | The CLI — agent definitions, skills, services, triggers, and the local API.       |
| [vetra-app/](vetra-app/)           | The Powerhouse Reactor package — document models, editors, processors, subgraphs. |
| [lab/](lab/)                       | Docker-based e2e reproduction of the publish → build → run pipeline.              |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Durable map of how the runtime fits together.                                     |
| [CLAUDE.md](CLAUDE.md)             | Agent/contributor instructions and dev-daemon gotchas.                            |


## Publishing

```sh
pnpm publish:dev          # publish to the dev registry
pnpm publish:staging      # publish to staging
pnpm publish:production   # publish to production
```

## Troubleshooting

- **"I fixed it but nothing changed."** The Studio service is detached and
survives the REPL, so rebuilds aren't picked up until it's cycled. Stop it
with `vetra vetra-studio-stop`, then re-run `pnpm dev`. Don't `pkill` the
processes — the managed stop command kills the whole group cleanly.
- **Port collision (8090 / 27370 / 59220).** Vetra derives its Studio,
Connect, and Switchboard ports from the CLI name with no fallback. Free those
ports (stop any prior `vetra-studio`) before starting.
- **Agent types but never replies / a profile is missing.** Agent profiles and
skills are generated into `gen/`. After editing agents or skills run
`pnpm --filter vetra-cli build:assets` and restart the REPL — `pnpm dev`
does not regenerate them.

More detail on the dev-daemon model and reload story lives in
[CLAUDE.md](CLAUDE.md).

## Contributing

The codebase ships three durable docs that carry project state across sessions:
[ARCHITECTURE.md](ARCHITECTURE.md) (how it fits together), [HANDOFF.md](HANDOFF.md)
(in-progress publish/dynamic-load work), and [TODO.md](TODO.md) (backlog). Read
them before non-trivial changes. To validate the full publish/build/run pipeline
without touching production, use the [lab](lab/README.md):

```sh
./lab/ci/run-prodclose-e2e.sh
```

## Learn more

- [Powerhouse](https://www.powerhouse.inc/) — the broader platform
- [Vetra Academy](https://academy.vetra.io/) - Vetra documentation 
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime internals

## License

[AGPL-3.0](LICENSE). If you run a modified version of Vetra as a network
service, the AGPL requires you to make your modified source available to its
users.

