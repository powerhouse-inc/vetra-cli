# Architecture: vetra

This document describes how `vetra` is put together — the components
that run in-process, the services it spawns, and the preview pipeline
that lets a freshly-generated document model be rendered live in a
browser editor as the agent iterates.

For in-progress work and setup steps, see `HANDOFF.md`. This file is
the durable map of how the pieces fit; that file is the working state
of the open work.

## High-level component map

```
                  ┌────────────────────────────────────────────────┐
                  │           vetra process (the Cli)              │
                  │                                                │
                  │  ┌─────────────────┐                           │
   user ────────► │  │ Interactive REPL│                           │
   (terminal)     │  │  (clint)        │                           │
                  │  └────────┬────────┘                           │
                  │           │                                    │
                  │  ┌────────▼────────┐    ┌──────────────────┐   │
                  │  │ Mastra agent    │◄──►│ Reactor client   │   │
                  │  │ (`createAgent`) │    │ (remote attach)  │   │
                  │  └────────┬────────┘    └────────┬─────────┘   │
                  │           │                      │             │
                  │  ┌────────▼─────────────────┐    │             │
                  │  │ vetra local API          │    │             │
                  │  │ HTTP + SSE on 127.0.0.1  │    │             │
                  │  │ :<OS port> — resolve/    │    │             │
                  │  │ events (+ future surface)│    │             │
                  │  └──────────────────────────┘    │             │
                  └──────────────────────────────────┼─────────────┘
                                                     │ GraphQL
                  ┌──────────────────────────────────▼─────────────┐
                  │ Switchboard (its own host): GraphQL + MCP      │
                  │ drive address <switchboard>/d/<slug>           │
                  └────────┬───────────────────────────────────────┘
                           │
                ┌──────────┴──────────────┐
                │                         │
                ▼                         ▼
       ┌──────────────────┐  ┌─────────────────────┐
       │ Connect          │  │ reactor-project:    │
       │ (static SPA      │  │ the Preview run     │
       │ serving this     │  │ (hosts/preview):    │
       │ package's        │  │ Switchboard +       │
       │ editors)         │  │ Connect with Vite   │
       │ Drive editor =   │  │ HMR. Preview docs   │
       │ Vetra Studio     │  │ live here.          │
       └────────┬─────────┘  └─────────────────────┘
                │                       ▲
                │  iframe deep-linked   │
                └───────────────────────┘
```

The package is one Powerhouse package, `@powerhousedao/vetra-cli`: document
models and editors in the standard folders, the Cli in `cli/`, exported as
`./cli` (`cli/index.ts`, built by `ph build` to `dist/node/cli/index.mjs`).
Its own models and editors are `vetra/studio-product` and the `vetra-studio`
drive app. The spec documents (`powerhouse/brand-sheet`, `problem-sheet`,
`audience-sheet`, `feature`, `work-breakdown-structure`) and their editors are
`@powerhousedao/vetra`'s. The switchboard (`packages.list`) and the Studio
Connect (`powerhouse.config.json` `packages`, `provider: "local"`) load that
package beside this one; the spec registry (`cli/src/vetra-app-models.ts`)
and `vetra-studio` import them from it. No type is registered twice.
The Cli runs three ways, all through clint's Cli runner (`runCli`):

- a host: `ph run studio` (the compound in `hosts/studio`, see "Hosts")
  starts the Studio switchboard and Connect, then loads `./cli` and hands it
  the switchboard's drive address;
- the `vetra` bin (`bin/vetra.mjs`) over the built `./cli`;
- `pnpm dev` (`tsx cli/src/main.ts --workdir ../vetra-test`) from source.

A command of the bin or `pnpm dev` that needs the reactor or the agent is a
thin client of the Studio that runs for its project (`studioRun` in
`cli/src/running-studio.ts`, clint's `RunOptions.forward`). The command says
so in its meta (`needs: "reactor"`: the `spec-*` commands that use the
drive, `preview-models`, clint's `attachment-*`); a skill command and a bare
prompt need the agent without saying so. The calling process sends the
command (id, parsed input, working folder, caller's folder, terminal and
colour, OS user and pid, piped input where the command declares `stdin`)
over the Studio's control channel; the Studio's Cli validates the input
against the command's schema again, runs it with its own reactor, agent and
services, streams stdout and stderr back as they are written, and answers
with the exit code. Ctrl-C in the caller, or a caller that goes away,
aborts the command's `context.signal`. The caller builds no reactor and no
agent, and loads none of their packages.

Such a command signs as the person who typed it (`cli.configureIdentity` in
`cli/src/cli.ts`, `cli/src/auth/caller-session.ts`). While it runs in the
Studio, each action the Studio's reactor client signs is sent back over the
open control connection and signed in the caller's process, and the
requests carry the caller's bearer; work the command leaves running cannot
sign. The caller opens its session at the first such ask only: the active
identity (the Renown login, else the pseudonym, made then if there is none),
a P-256 session labelled `vetra` in `~/.ph/identities/<address>/sessions/`,
its credential issued by the pseudonym for 30 days and recorded in the
project's data folder (`.ph/credentials/`). A pseudonym's password is asked
on the caller's terminal. A prompt is the agent's work and signs as the
Studio's Cli. A Studio that cannot ask (another version) is refused with
"cannot sign as you; restart it".

That Studio is found through its run record (`findRunningInstance` of
`@powerhousedao/host-core/instance`, which reads records and loads no
runner): the instance is the Studio host plus the data folder
(`PH_USER_DATA_DIR`, else the folder `--workdir` or the current folder
names), so a `vetra spec-list` in a project reaches that project's Studio.
The record holds the channel's address and token and is readable by its
owner only. With no Studio the command is refused with a message that names
`ph vetra`; with a Studio of another control protocol, with one that names
both protocols. Commands that need neither run in the calling process.

The calling process attaches to a drive itself in these cases only:
`VETRA_SWITCHBOARD_URL` (`<switchboard>/d/<slug>`) is set (cloud Studio,
scripts); `--local` precedes the command (the `studio` drive of the
project's running Studio); the shell (`-i` with a running Studio, else the
variable only); `vetra-agent-run`, which drives an agent of its own
(`STANDALONE_COMMANDS`). Agent conversation logs live under
`<workdir>/.ph/vetra/logs/<agent>/`.

Internally:

- The **agent**, the **reactor client** and the **vetra local API** run
  inside the vetra node process. The documents live on the switchboard.
- The **routine** runs registered **triggers** on a poll loop in the
  same process (`chatSessionWatchTrigger`, the runtime spec sync).
- The **switchboard** and **Connect** (serving this package's Studio) are
  hosts of their own (B2). **reactor-project** sessions run as child
  processes managed by clint's service manager: previews, one per active
  build, spawned on demand by the agent.

## Repositories

- `vetra-cli` — this repo. CLI definition, agents, services, triggers,
  tool implementations, the local API server, and the document models,
  editors, processors and subgraphs of the Studio (package root).
- The Powerhouse monorepo — framework and stack: `packages/clint` (Cli,
  runners, reactor attach, service manager, routine loop, REPL, agent
  loader), `packages/clint-common` (chat-session model and triggers),
  `apps/switchboard`, `apps/connect`, `packages/reactor`,
  `packages/reactor-browser`. Linked locally with
  `workspace/local-link/link.sh`; published versions come from the
  `pnpm-workspace.yaml` catalog.

## Hosts

Eight host files under `hosts/` (shipped in the package, `files`). Each
host's `name` is its folder name: `ph run <host> --stop` finds the run
record by the word typed. None imports `outputs.js` or
`powerhouse.config.json`; cross-host values are literal `$output` tokens, so
the files read the same when the package supplies them to another project.
A host may import a sibling host file (`connect` and `studio-signed` do).

| Host | Runner | What it is |
|---|---|---|
| `switchboard` | `@powerhousedao/ph-cli/runners/switchboard` | The Studio switchboard: port 8091 on `127.0.0.1`, plugins `mcp` and `attachments`, `auth` off, `createSignaturePolicy: "legacy"` (a local Studio's Cli attaches without a signer). Its config file is the package's empty `hosts/switchboard/config.json` (`configFile: "${package}/…"`), its packages are `${package}`, `@powerhousedao/clint-common` and `@powerhousedao/vetra` with `disableLocal: true` (the working directory is not loaded), and its identity is `${userData}/.ph/vetra/switchboard/{.keypair.json,.renown.json}`. Declares one drive: slug `studio`, name `Home`, `powerhouse/document-drive`, `preferredEditor: vetra-studio` |
| `connect` | `@powerhousedao/ph-cli/runners/connect` | The Studio SPA: port 8090, `outDir: "${package}/dist/connect"` (`build` writes it, `serve` serves it), branding and Renown namespace. A remote client of the switchboard (no reactor in the tab); its server proxies the switchboard's paths (`runner.proxy` = the switchboard's `origin`), so the browser talks to 8090 only. `runner.serveFiles` serves `/studio.config.json` from `${userData}/.ph/vetra/studio.config.json`, read per request (`no-store`, 404 while missing), and the Vetra Labs screenshots of the Build and Deploy placeholder pages, `/vetra-labs/<page>.jpg` from `${package}/hosts/connect/labs/` |
| `cli` | `@powerhousedao/clint/cli-runner` | This package's `./cli`, with one remote backend on the switchboard's `drives.studio.url`. `ph run cli build` compiles skills and agent profiles |
| `studio` | `@powerhousedao/host-core/runners/compound` | `switchboard`, `connect`, `cli`; default verb `serve` (the built Studio). The tokens order the start: switchboard, then Connect, each in its own process; the Cli last, in the compound's process, on the terminal. Its end ends the stack |
| `studio-signed` | `@powerhousedao/host-core/runners/compound` | The same three members for a local check of signing: the `switchboard` and `connect` members restate their hosts' `reactor` with `createSignaturePolicy: "v2-required"` (a member's `reactor` and `config` replace the host's whole sections; only `runner` key-merges), the switchboard's stores move to `${userData}/.ph/vetra-signed/{reactor-storage,read-storage}`, so legacy and v2 documents never share a store, and its identity to `${userData}/.ph/vetra-signed/switchboard/`. Auth stays off. Not run by anything; see "The signed check" |
| `preview-switchboard` | `@powerhousedao/ph-cli/runners/switchboard` | The Preview switchboard: port 8093 on `127.0.0.1`, plugins `mcp`, `attachments` and `inspector` (`reportFile: "${userData}/.ph/vetra/preview/inspector.json"`), `auth` off. The project (the working directory) is its local package, loaded from source at `dev`; its config file is the package's empty one, so the project's `packages` list and registry are not read. Stores and identity under `${userData}/.ph/vetra/preview/`. Declares one drive: slug `preview`, name `Vetra Preview` |
| `preview-connect` | `@powerhousedao/ph-cli/runners/connect` | Generic Connect over the project at `dev` (its editors from source): port 8092, plugins `generic` only (declared, so no default composition and no studio mode), a remote client of the Preview switchboard's `preview` drive, proxying its paths. Renown namespace `vetra-preview` |
| `preview` | `@powerhousedao/host-core/runners/compound` | `preview-switchboard`, then `preview-connect`; default verb `dev`. The Cli's `reactor-project` service runs it in the project (see "reactor-project service"). Its members are named apart from the Studio's: both compounds run in one project |

The drive slug is `studio`, not `vetra` or `vetra-*`: loading
`@powerhousedao/vetra` registers its codegen processor, which attaches to
those. The Cli finds the drive by its name, `Home` (clint's `ensureDrive`),
so the switchboard must declare that name or the Cli creates a second drive.

`ph run studio -- --workdir <dir>` passes `--workdir` to the Cli; without it
the Cli works in the project root. `ph run studio dev` runs the members at
`dev` (the Cli still at `run`, from the built `./cli`).

Ports: 8090 Connect (the Studio's address), 8091 the switchboard, an OS
port for the vetra local API (named in `studio.config.json`, see "vetra
local API"). Neither runner sets `strictPort`, so a taken port moves to the
next free one and the outputs carry the real one: a second Studio on the
same machine (another project, so another data folder) gets its own. The
four numbers (8090 to 8093) are preferences; every reader takes an address
from the run record or from an output token, none from the number.

**One instance per host and data folder.** A run is keyed by its host and
its data folder (`instanceKey` in host-core). A second `ph vetra` in a
project whose Studio runs starts nothing: it prints the running instance
(pid, data folder, addresses, record path) and ends with code 0. Two
projects run a Studio each, side by side.

Stores: `${userData}/.ph/vetra/reactor-storage` and
`${userData}/.ph/vetra/read-storage` (PGlite), the switchboard's identity in
`${userData}/.ph/vetra/switchboard/`. `${userData}` is `PH_USER_DATA_DIR`,
else the project root. Under the same `.ph` tree: the run records and member
logs, `.ph/run/{studio,switchboard,connect}.json` and
`.ph/services/{switchboard,connect}/` in this repository, and
`.ph/run/@powerhousedao/vetra-cli/` and
`.ph/services/@powerhousedao/vetra-cli/` in another project.

**Both forms, one set of files.** `${package}` is the real root of the
package that supplies the host, and the project root for a project host: in
this repository both are the repository root, so `ph run studio` here and
`ph run @powerhousedao/vetra-cli/studio` in another project read the same
host files. The switchboard loads this package (`${package}`: from
`dist/node` at `serve`, through the Vite loader at `dev`), clint-common and
`@powerhousedao/vetra` (each name found from the package), never the
project's code (`disableLocal`), and reads the package's empty
`hosts/switchboard/config.json`, never the project's
`powerhouse.config.json`: no project packages, no `packageRegistryUrl`, so
nothing is fetched from a registry. Connect serves the package's
`dist/connect`; `ph run <package>/connect build` is refused in another
project (the package builds it). Relative paths in a host file still
resolve against the project. `@powerhousedao/vetra-cloud-package` is a
devDependency and no Studio package: its processors and subgraphs belong to
the cloud switchboard, and `cloud-client/` (the Studio's Deploy view, the
Cli's cloud commands) imports its document models. Every build inlines that
model code (`ph-cli build` leaves only declared packages and the shared set
external), so the published package neither declares nor imports it; it is
installed from a registry URL, which pnpm refuses in a sub-dependency. `dev` on the package's compound runs Vite
over the project: unsupported for Studio.

`hosts/tsconfig.json` type-checks the host files (`tsc -p hosts`, part of
`pnpm typecheck`); `hosts/types.d.ts`, the two `outputs.js`/`outputs.d.ts`
and `powerhouse.config.d.json.ts` are written by `ph-cli generate hosts`.
The `@satisfies {PHHost}` tag sits on the exported expression: in front of
`export default` TypeScript ignores it.

### The signed check (`hosts/studio-signed`, by hand)

What a person runs to see a signed Studio on this machine (design B3,
acceptance A10). It needs a wallet that can sign in on Renown; no `ph login`
is needed: a switchboard without a keypair generates one at
`${userData}/.ph/vetra-signed/switchboard/.keypair.json` and signs with it. It cannot run next to a
`studio` stack (same ports, and the members' run records
`.ph/run/{switchboard,connect}.json` share names).

1. Build once: `pnpm build`, then `pnpm build:connect`. Ports 8090 and 8091
   free.
2. Start it from this package's root (Git Bash); keep the data dir apart
   from the workdir, so the switchboard's keypair and the agent's
   (`<workdir>/.ph/vetra/agent/.keypair.json`) stay two identities:

   ```sh
   export PH_USER_DATA_DIR=<fresh data dir>
   export PORTLE_AUTOSTART=0
   export VETRA_ENVIRONMENT_ID=local-signed-check   # any value: the Cli signs as the agent
   export ADMINS=<your wallet address>              # the only wallet the agent may act for
   export VETRA_SESSION_EXPORT_SECRET=<long random string>
   # optional, a chat without an LLM key (its spec commands need the workdir
   # to be a project: a powerhouse.config.json and a node_modules):
   export VETRA_REPLAY_FIXTURE=$PWD/cli/e2e/fixtures/chat-spec.replay.json
   pnpm exec ph-cli run studio-signed -- --workdir <fresh project>
   ```

   Expect `Switchboard identity initialized: did:key:…` and no `No signer is
   configured` warning in `$PH_USER_DATA_DIR/.ph/services/switchboard/*.log`,
   and no `[signing]` error from the Cli. With an environment id the cloud
   triggers (product requests, live health) also run and log their failures
   against the made-up id.
3. Authorize the agent before the first message. With an environment id
   the local API takes no loopback pass: the tab's "Authorize agent" sends
   the signed-in wallet's bearer bound to the Studio's origin
   (`studioOrigin` in `studio.config.json`), which passes only for an
   `ADMINS` wallet (not run yet). The operator secret passes the gate too;
   the local API's address is `previewServerUrl` in
   `http://127.0.0.1:8090/studio.config.json`:

   ```sh
   S=$VETRA_SESSION_EXPORT_SECRET
   API=<previewServerUrl from http://127.0.0.1:8090/studio.config.json>
   curl -s -X POST -H "Authorization: Bearer $S" $API/auth/start
   # open pending.loginUrl from the answer, approve with the ADMINS wallet
   curl -s -X POST -H "Authorization: Bearer $S" "$API/auth/confirm?wait=60000"
   # {"authenticated":true,"address":"0x…"}; "not-owner": that wallet is not in ADMINS
   ```

4. Open the printed `Vetra Studio: http://127.0.0.1:8090/d/<id>` and sign in
   with Renown in the tab (the account menu) with the same wallet before
   starting a conversation: the tab creates the conversation, and a
   `v2-required` document refuses an unsigned create. On `127.0.0.1` the tab
   does not ask for the sign-in itself.
5. Start a session in the Agent panel and send a message. Expect the
   agent's answer, then every operation the agent
   wrote carrying its key: find the conversation with
   `findDocuments(search: { type: "powerhouse/chat-session", parentId: "<id>" })`,
   then on `http://127.0.0.1:8090/graphql`:

   ```graphql
   { document(idOrSlug: "<session id>") { document { operations { items {
       index action { type context { signer { user { address } app { key } signatures } } } } } } } }
   ```

   The agent's operations name your address and the agent's `did:key` (its
   keypair under `<workdir>/.ph/vetra/agent/`), each with a signature.
6. Stop: `pnpm exec ph-cli run studio-signed --stop`.

## Components, in detail

### Start path

`cli/src/cli.ts` imports only what `--help` prints: each command group's
`commands/<group>/meta.ts` (id, description, input schema; zod only) and
the lifecycle hooks. Everything else loads on first use, through literal
`import()`s the bundler splits into chunks:

- a command's implementation at its first run (`lazyCommand` in
  `cli/src/lazy.ts`; the command file spreads its meta into `defineCommand`,
  so the two cannot drift);
- every trigger when the routine sets it up (`lazyTrigger`);
- Mastra and the agent definitions (`agents/agent.ts`) at the first chat or
  agent run (`cli.configureAgent`);
- the document models (this package's, `@powerhousedao/vetra`'s,
  clint-common's) and the Renown identity when a command attaches
  (`remote` in `cli.configureReactor`);
- the product model inside the check recorder, with the first recorded run.

`cli/tests/build/start-path-imports.test.ts` runs the source entry and the
built bin in a child process with an import-recording hook and fails when
`--help`, `--version`, a command's `--help` or `config --list` loads Mastra,
the reactor client, Renown, clint-common, the vetra models, `document-model`
or another heavy package. The same holds, under a module budget, for the
calling side of a command the running Studio runs (`spec-list` against a
control channel the test answers) and for its refusal with no Studio. A new
command needs a meta entry and a `lazyCommand` line in its group's
`index.ts`, and `needs: "reactor"` in the meta when it uses the reactor or
the Studio's services.

### Reactor (remote attach)

`cli.configureReactor` in `cli/src/cli.ts` declares `remote` as a function
clint's runner calls with the setup context at attach: the document models
(this package's `vetra/studio-product`, `@powerhousedao/vetra`'s with the spec
documents, and clint-common's), the drive
`Home` (`preferredEditor: vetra-studio`, found by name; the switchboard host
declares it) and the subscriptions, plus, in a cloud Studio, the agent's
identity. The runner attaches with clint's `attachDefaultReactor`: a
`GraphQLReactorClient` on the switchboard, `personalDriveId` = the `Home`
drive. `create` only throws: vetra builds no in-process reactor.

The Home drive holds: chat session documents, spec documents, and any
other domain content the studio surfaces. Spec documents live in the drive
only: no `specs/` folder of a project is read or written. A spec
document a `spec-*` command, the runtime sync or the explorer adds goes in the folder
`@powerhousedao/vetra/drive-layout` gives its type (`specify/document-models`,
`ideate/features`, …), made on first use; documents already in the drive
are not moved, and chat sessions stay at the root.

**Signing.** A cloud Studio (`VETRA_ENVIRONMENT_ID` or
`config.environmentId`; `isCloudStudio` in `cli/src/auth/studio-mode.ts`)
attaches with the agent's Renown identity (`cli/src/auth/studio-identity.ts`):
`signer` = the workdir's Renown signer, `tokenProvider` = its bearer while it
has a user, `onSignerChange` = Renown's `user` event, `legacyDocuments:
"refuse"`. clint hands them to its writes, emits `powerhouse:writes:ready`
when the owner authorizes the agent, and reconnects the realtime socket with
the new bearer. A local Studio passes none: no keypair is written at start,
and writes go out unsigned. While the signer has no user every write is
refused, a legacy one included (clint documents this limit), so a signer goes
only to a cloud Studio, whose switchboard creates `v2-required` documents.

The signature mode of the spec writes is the switchboard's create policy
(`studioSignatureMode`: `client.getCreateSignaturePolicy()`, read once per
client). The Cli plans no mode, writes no marker and creates no drive: the
Studio drive is host data in both modes. A cloud Studio on a `legacy`
switchboard, or a local one on a `v2-required` switchboard, logs one
`[signing]` error at start and runs on.

### Switchboard

Not started by the Cli. The switchboard is its own host,
`hosts/switchboard` (see "Hosts": the Studio drive, its slug and preferred
editor are host data); the Cli reaches it over GraphQL at the drive address
the runner hands over. The Cli runs no proxy of its own.

### Connect (Vetra Studio)

Static SPA built from this package (`dist/connect/`), served by its own
host, `hosts/connect` (the former `build:connect` flags are its `runner`
and `config`). See "Build-output split" below for how that directory is
produced.

**Build-output split — two independent commands.** The package ships
two artifact families and they are built separately:

- `pnpm build` (the ph-version writer, `ph-cli build`, then
  `ph-cli run cli build`) emits `dist/{browser,node,types}` — the
  package's consumable exports, `./cli` included — and the skills and
  agent profiles in `dist/skills/{skills,agent-profiles}`.
- `pnpm build:connect` (`ph-cli connect build`, i.e. `ph run connect
  build` over `hosts/connect`) builds the package again, then the SPA
  bundle Connect serves into `dist/connect` (`runner.outDir`), with the
  host's branding, favicon and Renown namespace. The bundle freezes a
  snapshot of `powerhouse.manifest.json` and the local editor modules at
  build time. Its last step, `cli/scripts/pin-connect-layer.ts`, declares
  the `external-packages` cascade layer first in `dist/connect/index.html`
  (`lifecycle/connect-layer-order.ts`), so a registry-served package
  stylesheet never outranks the Studio's own. Nothing patches the bundle at
  run time: the Cli writes nothing into the installed package.

`pnpm build` does **not** rebuild `dist/connect/`, and leaves it and
`dist/skills` in place. Editing `editors/*`, `powerhouse.manifest.json`,
or anything the SPA loads requires running both commands and restarting
Connect (it serves `dist/connect` with no watch). A common failure mode:
the source manifest lists the new app under `apps[]` but the bundled SPA
still carries the empty pre-edit manifest, so Connect falls back to
`GenericDriveExplorer` and the new drive editor never shows up.

**The drive URL.** Connect's server merges the host's config over the
baked `powerhouse.config.json` per request (`serve`): the Studio drive
and the remote backend come from the switchboard's outputs, written as
`${origin}/d/studio` because Connect proxies the switchboard. Nothing is
stamped into `dist/connect` for it. Connect serves `/studio.config.json`
from `${userData}/.ph/vetra/studio.config.json` (`runner.serveFiles`), which
the Cli writes once its local API listens (see "vetra local API"); while it
is missing it is a 404 and the SPA sends nothing to the local API.

The user's landing experience — `Vetra Studio` — is a custom **drive
editor** registered against `powerhouse/document-drive` and selected
via the vetra drive's `preferredEditor` field. A Studio runs inside one
project, and its page is the **panel shell** (`shell/StudioShell.tsx`, see
"Drive editor (Vetra Studio)"): a top bar with the project's name and
version (its `package.json`, from `GET /project-package` with no
parameter) over the Specs, Test / Preview and Agent panels. There is no
idea screen, no project home and no "Build it": Studio starts no product
and creates no project (a new app starts with `ph init`, then Studio in
it). A `vetra/studio-product` document in the drive changes nothing on the
page.

### vetra local API

HTTP + SSE service hosted inside the vetra node process on `127.0.0.1` and
an OS port, so two Studios on one machine never share one. Once it
listens the Cli writes `studio.config.json` at
`${userData}/.ph/vetra/studio.config.json` (`preview-server/studio-config.ts`;
`PH_USER_DATA_DIR`, else the project root, as the host runners resolve it)
and removes it at its end (only while it still names this Cli's address).
It holds `previewServerUrl` (`http://127.0.0.1:<port>`), `studioOrigin`
(the Connect member's origin), `studioDriveId`, and for a cloud Studio
`environmentId`, `cloudSwitchboardUrl` and `packageRegistryUrl`. The
Studio's Connect serves it (`runner.serveFiles`, read per request, 404 while
missing); the SPA reads it and calls the local API directly, and sends
nothing while it is missing (a guessed port could be another Studio's). The
loopback bind is not relied on as the access control: a
deployment may put a proxy in front, so every route that isn't needed to
render a preview is owner-gated per request (see "Preview-server access
gate" below). CORS is `*`: the gate is a bearer header, never an ambient
cookie.

Implemented as a trigger (`cli/src/triggers/preview-server.ts`)
so it gets the framework's `ServiceManager` + event-bus access via
`TriggerContext`. Server module lives at `cli/src/preview-server/`.

**Endpoints (current).** Every route acts on the project the Cli works in,
its workdir: no route takes a project. A workdir that is no Reactor Package
answers `unknown-project`.

- `GET /resolve?doc=<id-or-slug>` (or `drive=`, `home=1`) — read-only.
  Returns the live preview URL in the Preview run or a state code
  (`no-target`, `unknown-project`, `project-stopped`, `starting`, `ready`).
  The editor calls this on every relevant state change.
- `GET /preview/models` (`?full=1`) — owner, read-only. What the Preview run
  has loaded, from its inspector's report (see "reactor-project service"):
  `not-running`, `starting`, or `ready` with the model types, their versions
  and, with `full`, each version's document model state.
- `GET /preview/status` — owner, read-only (`preview-server/status.ts`). The
  Preview run's state in words the Studio shows: `ready`, `starting`,
  `stopped`, `unavailable` with the `reason` and `hint` of a start that
  would be refused (the workdir is no project, or the first failing
  preflight check of the `reactor-project` service, run here without
  starting anything), or `failed` with the run's error.
- `GET /hosts`, `POST /hosts/start?host=`, `POST /hosts/stop?host=` — owner.
  The project's own hosts (see "Project hosts"): the list with each host's
  state, a start (202 once it is under way; the state is read from the
  list) and a stop (answers when the host has stopped). 404 for a host the
  project does not have, 409 for one the Studio does not start, 500 with
  the reason for a stop that did not happen.
- `GET /project-package` — read-only. Returns the project's package
  identity (`{ kind: "ok", name, version }`) read from
  `<workdir>/package.json`, or `unknown-project` / `no-package`. The
  Studio page's top bar calls this.
- `GET /release-status?registry=<url>` — read-only. Compares
  the project's current source content hash
  (`helpers/project-fingerprint.ts`) against the hash embedded in the latest
  published version on the registry (full packument via
  `cloud/registry-packument.ts`), returning `{ kind: "ok", upToDate,
  needsRelease, localVersion, publishedVersion, reason }` or
  `unknown-project` / `no-package` / `unknown`. `reactor-project-publish`
  embeds the hash at `package.json` → `powerhouse.contentHash`. The Deploy
  section's "up to date / needs release" indicator calls this.
- `POST /publish?registry=<url>` — build + publish the
  project's package for the Deploy flow (`preview-server/publish-project.ts`).
  Skips publishing when the source already matches the latest published
  version (same content hash); otherwise picks a free version and runs the
  **same publish sequence the agent's `reactor-project-publish` uses** —
  `publishReactorProject` in `commands/reactor-project/publish-core.ts` (embed
  content hash, `reactor-project/build.ts`, `npm publish --registry` with a
  token minted from the agent's Renown identity). The shared core bump-and-
  retries a registry version conflict (`bumpOnConflict`) so a stale packument
  can't surface a 409 to the UI. Returns `{ kind: "ok", packageName, version,
  registry, published }` (`published: false` = skipped, install the existing
  version) or `unknown-project` / `no-package` / `auth-required` / `failed`.
  The browser then installs that exact version into the target cloud
  environment (env-document edit + approve, signed by the user). This is the
  publish half of the Deploy section's per-environment Deploy/Update action.
- `POST /start` — idempotent. If an instance for
  the project is already `starting`/`ready`, returns
  `already-running`; otherwise spawns one via
  `services.start("reactor-project", ...)` and returns `started`.
  The editor calls this automatically when `/resolve` returns
  `project-stopped` — preview intent implies project should run.
- `GET /events` — SSE stream of `service:*` events filtered to
  `id === "reactor-project"`. The editor refetches `/resolve` on
  any event. 15s heartbeat keeps the stream alive through quiet
  periods.
- `GET /sessions` — gated. Lists the Studio drive's chat-session
  documents (`{ id, name, status, startedAt, threadId, agent }`):
  `client.find({ type, parentId: <drive> })`, the drive's `child`
  documents, every page. `503 reactor-unavailable` when no reactor is
  attached.
- `GET /sessions/export?id=<session>` — gated. Returns a zip
  (`application/zip`, attachment) bundling the session for debugging:
  `chat-session.json` (the reactor doc state), `chat-session-operations.json`
  (op history), `mastra-thread.json` (the Mastra thread `recall`ed by the
  doc's `threadId`, when the LibSQL store exists), `session.md` (the
  markdown log when `agentLogging` was on), and `metadata.json` (versions,
  model, flags, which sources were found). `404 unknown-session`,
  `503 reactor-unavailable`. Implementation: `preview-server/session-export.ts`.
- `GET /export?workspace=1` — gated. Streams a zip (`application/zip`,
  attachment `vetra-workspace.zip`) of the whole workdir under a `workspace/`
  prefix, excluding `node_modules`, build/cache output
  (`dist`/`build`/`.next`/`out`/`coverage`/`.turbo`/`.cache`), `.git`, the `.ph`
  store, and `.env*` secrets. Deflate runs on fflate's worker pool and
  the archive streams to the response (bounded memory; the main thread stays
  free). Single-flight: a concurrent request gets `409 export in progress`. A
  general endpoint — `workspace` is the only selectable part today. `400` when
  no part is selected. Implementation: `preview-server/workspace-export.ts`.
- `GET /export/status` — public; returns `{ authorized }`: whether *this
  caller* passes the owner gate. The studio "Download workspace" button reads
  it to send a signed-out user to Renown sign-in instead of failing the fetch.
- `GET /auth/status`, `POST /auth/start|confirm|logout` — owner-only; the
  agent's Renown identity (studio "Authorize agent" / publish permission).
- `GET /healthz` — liveness check.

**Preview-server access gate** (`preview-server/request-auth.ts`,
`createRequestAuthorizer`). Public routes: `/healthz`, `/version`,
`/resolve` (no absolute `projectPath`, no raw error text), `/events` (event
types only — failure text is not forwarded) and `/export/status`. Every other route (`/project-package`, `/release-status`,
`/publish`, `/preview/*`, `/start`, `/restart`, `/hosts*`, `/sessions*`, `/export`, `/auth/*`) is
owner-only and checks **the request**, never the daemon's own Renown
sign-in. It passes when the request carries:

1. the operator secret `VETRA_SESSION_EXPORT_SECRET` as
   `Authorization: Bearer <secret>` or `?token=` (sha256 + timingSafeEqual) —
   the support path; or
2. the signed-in user's Renown bearer, minted by the studio client **for this
   Studio only**: `aud` = the Studio's origin, read per request from the
   ready Connect member's `endpoints.connect` (`studioUrlOf`; the client
   takes it from `studioOrigin` in `studio.config.json`, written from the
   same member, so `localhost` and `127.0.0.1` never disagree, and sends it
   to a direct base too). The gate requires that exact `aud` — a token with
   no `aud` (e.g. one minted for the switchboard, which refuses `aud`
   tokens) or another Studio's `aud` fails, so a token a malicious Studio
   captures can't be replayed here. The binding is to the **origin**
   (scheme + host + port), not the path: each Studio must be served from
   its own origin (true for cloud Studios, one subdomain each); two Studios
   under one origin with different base paths would accept each other's
   tokens. The client reuses one token until shortly before its 10-minute
   expiry rather than minting per call. Then `verifyAuthBearerToken` (signature +
   expiry), the claimed wallet must be in the pod's `ADMINS`, and
   `verifyAuthCredential` confirms on Renown that the wallet delegated to the
   token's app key (a self-signed token claiming the owner's address fails
   here). Bearers are verified on the Renown the Studio's Connect logs in on
   (`resolveStudioRenownUrl`). Delegation verdicts are cached per
   (app key, wallet) — what the lookup proves — for 5 min ok / 30 s refused,
   with concurrent checks sharing one lookup. A key verified in the last 24 h
   re-verifies without any cap, so the owner's polling never hits one and a
   flood of fresh attacker keys can't lock the owner's key out; keys not yet
   verified are capped at 3 lookups/min each and 30/min overall. A non-owner
   wallet never costs a lookup. Residual: a flood of fresh keys can delay an
   owner's *first* verification on a new device by up to a minute; or
3. local mode only — no studio environment id (`VETRA_ENVIRONMENT_ID`;
   `ADMINS` or the secret do not end it, since a project's `.env` may set
   them): a request from a loopback socket whose every
   `x-forwarded-for` hop is loopback (a proxy in front appends the real
   client address, so its LAN clients are refused), whose `Host`
   and `x-forwarded-host` are loopback, and whose `Origin`, if any, is
   loopback (blocks cross-site pages / DNS rebinding).

A cloud Studio never takes path 3, and with `ADMINS` unset (or no known
public origin) refuses every bearer (fail closed). Every refusal is the same
`401 {error:"unauthorized"}` — no oracle for which wallet is the owner. The
studio client (`editors/vetra-studio/.../hooks/preview-server-client.ts`) mints the
bearer from the Connect Renown session (`window.ph.renown`, `aud` =
`studioOrigin`) on every owner-only call, and sends none while
`studio.config.json` names no origin.

`POST /auth/confirm` in a cloud Studio keeps a completed agent login only when
its wallet is in `ADMINS`; any other wallet is logged straight back out
(`error: "not-owner"`), so the agent can't be switched to another identity.
The same rule applies whenever the agent's identity is read (`auth/renown.ts`
`getRenown`/`getAuthState`/`getBearerToken`/`getSigner`, …): a stored
non-owner credential (e.g. from before the rule) is cleared and the agent
reads as signed out.

Residual risks: (a) the owner's Renown session lives in Connect's origin; if
the owner signs into Renown on an attacker's page (a malicious Studio or
app), that page gets its own delegated app key for the owner's wallet and can
mint `aud`-bound tokens for any Studio — `aud` binding stops replay of
captured tokens, not a delegation the owner granted. Revoking the delegation
on Renown is the remedy. (b) Local mode behind a proxy relies on
`x-forwarded-host` for the browser's real `Host`; a proxy that keeps a
client-sent `x-forwarded-host` lets a DNS-rebinding page set
`X-Forwarded-Host: localhost` itself. Sub-agent threads (resource `cli-user-<agentName>`) are not bundled in
session exports — their per-delegation threadIds don't link back to a
session.

**Endpoints (planned but not yet built):**

- `GET /projects` / `GET /projects/subscribe` — broader projection
  of the service manager's reactor-project state, beyond the
  per-target resolution `/resolve` provides today.
- `GET /chat-sessions/:id/workflows` /
  `GET /chat-sessions/:id/workflows/subscribe` — workflow registry
  projection. Depends on the workflow registry itself, which is
  unbuilt.

The API surfaces two kinds of state:

- **Project runtime state** — projection of the service manager.
  Source of truth remains clint's service state,
  `<data folder>/.ph/vetra/services/reactor-project/<instance>.json` (instances
  keyed by a hash of the project path); the API is a fanout. `/resolve`
  is a per-target slice; the planned `/projects` endpoints would
  expose the full list.
- **Workflow registry state (planned)** — in-memory map of workflow
  instances per chat session. Not implemented yet.

The API exists for **cross-session, ephemeral runtime state** that the
editor needs to see live but that doesn't belong in CRDT-replicated
documents. The line is intentional (see "State transport" below).

The writes (`POST /start`) are scoped: only thing the editor can
trigger is starting a reactor-project that a session already pointed
at. It can't enumerate, stop, or otherwise mutate the manager.

### State transport: chat-session document vs local API

Two parallel channels carry state from the agent / runtime to the
browser-side editor. Each has a clearly-scoped purpose.

- **Chat-session document (reactor)** carries domain content and
  within-session UI signals: user/agent messages, tool calls, tool
  results, workflow dispatch events. Replicated, persistent,
  scrollable history. Read via standard reactor-browser
  subscriptions. The editor's "show this preview" signal is just the
  most recent relevant tool call in the session's history.

- **vetra local API (HTTP + SSE)** carries ephemeral runtime
  state that lives across or outside agent turns: project lifecycle,
  workflow live state (especially when V2 background tasks need to
  update state without an agent turn happening). Not persisted, not
  replicated; recomputed on each vetra boot.

The distinction is deliberate. Ephemeral runtime state in a CRDT
document creates noise in history and forces the editor to constantly
re-derive "current" from a log. Domain content in HTTP+SSE loses
replayability and forces re-fetching on every reload. Putting each
class where it belongs keeps both subsystems simple.

### Drive editor (Vetra Studio)

A custom editor registered for `powerhouse/document-drive`. Lives at
`editors/vetra-studio/`. The vetra drive's
document sets `preferredEditor` to this editor's id so Connect picks
it up automatically.

The page is the panel shell, `shell/StudioShell.tsx`. It covers the window
(`style.css` hides Connect's own sidebar while it shows; Connect's dialogs
stay above it) and has:

- **The top bar**: "Vetra Studio", the project's name and version, one
  toggle per panel, and the account menu (sign-in, Settings). A link to
  the project in Vetra Labs shows only when the shell is given its address
  (`labsUrl`); nothing configures one yet.
- **Specs**: the explorer of the specification drive, `VetraExplorer` from
  `@powerhousedao/vetra/editors/vetra-explorer` (a drive app of the
  monorepo's `packages/vetra`; it needs neither the Cli nor Labs). Its tree
  is the package row, then Ideate, Specify, Build and Deploy; a document
  row opens the document in its editor, which Connect hands the drive
  editor as `children` and the shell passes on. Ideate and Specify carry
  `+` (Connect's new-document dialog, limited to the stage's types); the
  shell creates the document with `addAgentWritableDocument`, so the agent
  can write it. Build and Deploy rows open placeholder pages showing the
  matching Vetra Labs screenshot (`shell/labsScreens.ts` names them;
  Connect serves them, see "Hosts").
- **Test / Preview**: Test is the Preview Connect on its `preview` drive in
  a frame (`shell/usePreviewHome.ts`: `/resolve?home=1` for the address,
  `/preview/status` for the reason when there is none, read again on the
  run's events and every 5 s). Until the run is ready the panel says it is
  starting, not running, not available (with the reason and hint) or
  failed (with the error). It starts nothing: the `preview-run` trigger
  does. A document created there lives in the Preview's stores
  (`.ph/vetra/preview/`). Preview is the project's own hosts
  (`shell/PreviewHosts.tsx`, `shell/useProjectHosts.ts` over `GET /hosts`,
  read again every 5 s and every 1.5 s while one starts or stops): a chip
  per host, Start or Stop for the chosen one, its status, the links its run
  record gives and a frame on its web address when it has one. A host the
  Studio does not start shows its `ph run` command instead (see "Project
  hosts").
- **Agent**: the chat pane (`ChatPane.tsx`): sessions list, a new session,
  the conversation.

Each panel closes from the bar's toggle and from its own header; the open
set is kept in the browser (`localStorage`, `vetra-studio:panels`; Specs
and Agent on a first visit). Specs and Test / Preview are at least 640 px
wide and scroll sideways below that; Agent keeps 420 px beside them and
fills the page alone. With every panel closed the page says so and offers
the three again.

Specs and Test / Preview also open in a tab of their own, without the bar
(`shell/panels.ts`, see "Browser addresses"). There a spec document is its
editor only; without a document the tab is the explorer.

The shell also subscribes via `fetch` to the vetra local API for the
project's package identity, and the chat pane via `useDocument` to the
drive and the selected chat session.

Beside `shell/`, the directory holds only what the shell reaches: the chat
pane and its tool renderers, the account menu's sign-in (`idea/`,
`hooks/useAgentAuth.ts`), the publish permission modal (`permission/`) and
Settings (`settings/`, with `github/`, `budget/`, `deploy/` and
`change/startChange.ts` behind it). The product flow has no page here
(no build, story, live or versions view); its Cli side (`cli/src/product`,
`cli/src/launch`) is unchanged.

### reactor-project service

The **Preview run** (`services/reactor-project.ts`, a clint host service):
the project's code (document models, editors, processors) on a stack this
package supplies, `ph run @powerhousedao/vetra-cli/preview dev` in the
project. `hosts/preview` is a compound of `preview-switchboard` (8093) and
`preview-connect` (8092, Vite HMR for editors), both in the run's one process.
The project is the working directory, so it is the switchboard's local
package and Connect's dev source; it needs no host of its own, and its
`powerhouse.config.json` `packages` list is not loaded. It does need its own
`ph-cli` and `@powerhousedao/connect` installed (the service's preflight).

**Apart from the project's data.** Every store the Preview opens is under
`<project>/.ph/vetra/preview/` (reactor store, read model, attachments, the
switchboard's identity); the project's own stores and hosts are never
opened. The switchboard runs no workflows plugin and has auth off (the
service env). Its run record is
`<project>/.ph/run/@powerhousedao/vetra-cli/preview.json`.

**Nothing of Vetra in the Preview.** A host loads only the packages it
lists. `preview-switchboard` lists none, so it loads the project alone: no
Vetra document model, no codegen processor, and no code is written from the
Preview. `preview-connect` declares its plugins (`generic`), so the `dev`
verb adds no default composition and no studio mode. The Studio's own
switchboard and Connect list `@powerhousedao/vetra` themselves (see "Hosts").
Generation stays the Cli's (`cli/src/generation`).

**Inspector.** `preview-switchboard` loads
`@powerhousedao/switchboard/plugins/inspector`. When its reactor is ready
and after every package reload it writes the loaded document model modules
(type, name, version and the `documentModel` state, per package) to
`<project>/.ph/vetra/preview/inspector.json`, a counter in `sequence`, and
removes the file when it stops. A file fits the rest of the host model (run
records, `studio.config.json`): the Cli needs no connection to the Preview
and no credential, and a reader started later sees the last report. The Cli
reads it in `helpers/preview-inspector.ts` and trusts it only while the
service instance is ready (a hard kill leaves the file). It is exposed as
the `preview-models` command (the agent's tool, always on) and
`GET /preview/models`.

**Model specifications from the runtime.** `triggers/runtime-spec-sync.ts`
reads each new report of a ready Preview and brings the Studio drive to it
(`helpers/runtime-spec-sync.ts`): one `powerhouse/document-model` document
per document type the project's own packages supply (`local`), holding every
loaded version's specification. Types of other packages get none. Each pass
is a diff (`helpers/model-spec-diff.ts`): a plan of document-model actions,
checked on a scratch document through the model's reducer before it is
dispatched. A document equal to the report gets no operation, so a restart
with unchanged code writes nothing. A new document is created holding the
reported state. A change no action expresses (an earlier version, the
version numbers, a refused action) replaces the document under a new id. A
type gone from the report loses its document.

The sync writes the drive only. The documents it keeps are listed in
`<project>/.ph/vetra/runtime-specs.json` (type → document id,
`helpers/runtime-spec-record.ts`), each before it exists. A reported type
that already has an unlisted model document (the agent's) adopts it: the
document is listed, then brought to the report. `spec-extract all` and a
`spec-generate` without a name leave listed documents alone.
The other spec kinds (editor, app, subgraph, processor) are not derived from
the runtime.

It starts with the Cli (`triggers/preview-run.ts`, not awaited) unless the
config says `previewRun: false` (env `VETRA_PREVIEW_RUN=0`), and on request
through the `reactor-project-start` tool or `POST /start`; every start is
idempotent. `reactor-project-start` is the command clint adds for the
service (the package defines none): the service manager returns the
instance that is up instead of starting a second. Ready once the run record
is live; stopped through its stdin
(the compound shuts its members down; its tree is killed only after 30 s),
by the service manager when the Cli ends. Ports are the hosts' data; a
taken port moves to the next free one.

**Beside the user's process supervisor** (`ph run supervisor`, one per OS
user, recorded in `~/.ph/supervisor/supervisor.json`; not the agent of that
name): clint's service manager starts the Preview run through it, so the run
is the supervisor's child and not the Cli's. The default
(`--lifetime caller`) behaves as above: the Cli holds a lease on the
supervisor's channel and the run stops, with its tree, when the Cli ends,
however it ends. `reactor-project-start --lifetime supervisor` leaves it
running after the Cli; a later Cli lists it and stops it through the
supervisor. With no supervisor recorded the Cli supervises the run itself;
with one recorded that does not answer, the start is refused. Forwarded
commands and the project hosts below do not go through it.

The service's endpoints come from the record (`previewEndpoints`):
`vetra-studio` = the Connect member's `endpoints.connect`,
`vetra-switchboard` = the switchboard member's `endpoints.graphql`,
`mcp-server`, and the **preview drive** (declared slug
`preview`, a generated id) as `vetra-preview-drive-url` and
`vetra-preview-drive-id`. Preview documents (instances of in-progress
document models) live in this drive. The agent's `spec-preview-*` tools
target it by default. The editor composes iframe URLs as deep links into
this drive's editor route.

There is one project per Studio, the Cli's workdir: a chat session never
names or switches projects.

### Project hosts

The project's **own** hosts (`cli/src/project-hosts/manager.ts`): the
folders of `<project>/hosts/`, found with host-core's `probeHostsFolder`
and `loadHost`, the discovery `ph run` uses. They are not the Preview run
and not this package's hosts: they run the project's stack on the
project's own stores (`dataDir` is the project).

- **State** comes from the run record (`probeRun` under the host file's
  `name`): `stopped`, `starting`, `stopping`, `running` (pid, the record's
  endpoints as links, the first `connect` endpoint as the web address) or
  `failed` with the reason. A host a terminal started shows as running
  too. No output is read.
- **Start** is `ph run <host> dev` through `spawnHost`, with the Cli's
  environment passed on, its output in
  `<project>/.ph/services/hosts/<host>/<host>.<time>.log`. Only hosts on
  the ph-cli `connect` or `switchboard` runner or the compound runner are
  started; any other (a desktop shell, a Cli) is listed with its command
  and refused. Nothing checks ports or orders hosts: a host that needs
  another fails with that host's own message.
- **Stop** is the end of the child's stdin for a host started here (its
  tree is ended only after 60 s, and the stop then says so), and
  `stopRun` (the run record's stop channel) for one started elsewhere,
  which is asked and never ended. Hosts started here stop with the Cli
  (the `preview-server` trigger's teardown).

Three commands carry it (`cli/src/commands/project-hosts`):
`project-hosts`, `project-host-start`, `project-host-stop`. In the running
Cli they act on its manager; from a second terminal they go over the Cli's
control channel (`project-hosts/control.ts`, methods `project-hosts.*`,
served from the `preview-server` trigger); with no running Cli the list
and a stop still work from the run records, and a start is refused, since
the host would end with the command.

### Agent

Created via `cli.configureAgent(createAgent)`. Mastra-backed.

Tool surface for MVP (see `HANDOFF.md` for the implementation
checklist):

- **Existing project lifecycle:** `reactor-project-start`,
  `reactor-project-stop`, `reactor-project-ps`, `preview-models` (the
  Preview run; no init and no project list: the workdir is the project, and
  no command takes a `project`).
- **Existing spec lifecycle:** `spec-create`, `spec-get`, `spec-list`,
  `spec-update`, `spec-delete`, `spec-extract`, `spec-generate`.
- **Preview document lifecycle (planned):** `spec-preview-create`,
  `spec-preview-get`, `spec-preview-list`, `spec-preview-update`,
  `spec-preview-delete`. Mirror the `spec-*` shape; operate on the
  preview drive of the project's run.

### Generation engine (`cli/src/generation/`)

Copied from the Powerhouse monorepo's `packages/codegen/src` and
`packages/vetra/codegen` at `cb9717f1de`; `@powerhousedao/codegen` is not
imported. One file is named differently:
`templates/boilerplate/editors/editors-list.ts` (`editors.ts` there), because
`ph build` stubs every `editors/editors.ts` on a host.

The spec-driven generation runs in the Cli's process: no `ph generate` child.

- `run.ts` is the entry. `generateFromSpec(kind, document, projectDir)`
  generates the code of one specification document (`document-model`,
  `editor`, `app`, `processor`, `subgraph`); `extractSpecDocuments(kind |
  "all", projectDir)` returns the documents the project's code describes.
  Neither touches a file of specifications.
- `spec-generate` calls the first once per drive document, `spec-extract`
  the second and writes the result to the drive.
  Both hold the project's codegen lock. Processor and subgraph generation
  still run the project's package manager for the dependencies they add.
- `codegen/`, `file-builders/`, `name-builders/`, `templates/`, `utils/` are
  the engine; `spec/` holds the spec type registry (`spec/spec.ts` is the
  barrel the spec commands import) and maps a spec to engine
  arguments. The spec document models themselves stay in
  `@powerhousedao/vetra`.
- Its suites are in `cli/tests/generation/` and run in `pnpm test`.

### Renown identity (agent authorization)

**Renown is the identity/auth provider.** The user authorizes the agent with
their Renown identity once; that authorization lets the agent act as the user
across Vetra Cloud and other Renown-protected services. The `deploy-environment-*`
tools are one consumer — they operate on the user's real Vetra Cloud environments
at `switchboard.staging.vetra.io` (the same switchboard the Studio's
Deploy section uses). The Node side lives in `cli/src/cloud/`.

Two Renown identities are involved: the user's wallet identity (browser, on
`renown.id`) and the agent's own `did:key` (backend). Authorizing the agent
delegates the user's wallet to that `did:key`.

- **Identity.** `@renown/sdk/node` `RenownBuilder` gives the agent a stable
  `did:key`. The keypair persists to `<workdir>/.ph/vetra/agent/.keypair.json` and the
  delegated credential to `<workdir>/.ph/vetra/agent/.renown.json` (workdir-scoped,
  apart from the instance key at `.ph/` root and the user's `ph login` in the home folder); `PH_RENOWN_PRIVATE_KEY` overrides the keypair
  for pre-provisioned deployed agents. `src/auth/renown.ts` caches one
  `IRenown` per workdir and exposes `getBearerToken` (no `aud` — the
  switchboard's verifier rejects it), `getSigner`, the auth state machine
  (`startAuth` / `getAuthState` / `confirmAuth` / `logoutAuth`), and
  `getRenownStatus`. (The Vetra Cloud resource layer — switchboard URL,
  environments, drive — stays under `src/cloud/`.)
- **Authorization is the user's action, from the studio.** The agent has a
  single read-only `whoami` tool (reports whether it's authorized, and as
  which address, and who the user is on this computer: their Renown login or
  pseudonym); it cannot log in. It reads the files only (the agent's
  credential, `@powerhousedao/shared/clis/identity` for the user, the owner
  rule from `src/auth/owner-rule.ts`): no Renown, no network. The studio header renders an **Authorize
  agent** button (`editors/vetra-studio/.../AgentAuthButton.tsx`, left of "Auto-follow
  agent") that drives the console flow via the preview-server (the in-process
  local API, sharing the same per-workdir `IRenown`): `POST /auth/start`
  builds the `<renownUrl>/console?session=…&connect=<agentDid>` URL and opens
  it; the user approves with their wallet on `renown.id`; `POST /auth/confirm`
  polls `<renownUrl>/api/console/session/<id>` and runs `renown.login` to store
  the credential; `GET /auth/status` and `POST /auth/logout` round it out. (An
  in-app one-click authorize isn't possible — the wallet session and credential
  publishing live on the
  `renown.id` origin.) The Renown server URL defaults to
  `https://www.renown.id` (`config.cloudRenownUrl` overrides); the switchboard
  URL defaults to staging (`config.cloudSwitchboardUrl`).
- **Publish path (live).** `reactor-project-publish` mints a registry-bound
  bearer token from the agent's identity (`getRegistryToken` in
  `src/auth/renown.ts` → `generateAccessToken(…, { aud: registryUrl })`, the
  same mechanism as `ph publish`) and passes it to `npm publish` as the
  ephemeral `_authToken`; `reactor-project-publish-status` reads the registry
  packument over HTTP with the same token. No `npm login` — authorizing the
  agent is the only prerequisite.
- **Read path (live).** `deploy-environment-list` / `-get` query
  `myEnvironments` over GraphQL with the bearer token
  (`src/cloud/graphql.ts`) and trim to the caller's own environments
  (`filterOwn`, mirroring the Studio).
- **Write path (live).** `deploy-environment-create` / `-update` load (or
  create) the `vetra-cloud-environment` document via a `RemoteDocumentController`
  and push signer-signed actions against the cloud, mirroring the Studio
  (`src/cloud/environments-write.ts`, delegating to
  `cloud-client/`).
- **Wait.** `deploy-environment-wait` polls the read path every 5s (up to a
  caller-set timeout — default 30s, max 60s) until the status leaves the
  in-flight set (`CHANGES_*` / `DEPLOYING` / `TERMINATING`) and settles, so the
  agent blocks in a single tool call instead of looping `deploy-environment-get`
  (`src/commands/deploy/wait.ts`).

### Triggers

Registered in `cli.ts` by id (`lazyTrigger`), loaded when clint's routine
loop sets them up, and run as part of it.

- `chatSessionWatchTrigger` (clint-common) — watches chat-session
  documents for new user messages and forwards them to the agent.
- `driveLayoutTrigger` — on its first poll with a drive to reach, adds
  the package drive layout's folders the Home drive lacks
  (`ensureDriveLayout`). Once per session; it moves no document, and a
  drive that refuses the folders is logged and left.
- `previewServerTrigger` — runs the local API server. Triggers
  receive `commandContext.services` + `commandContext.on`, which is
  exactly what the http handlers need. `setup()` boots the server,
  `teardown()` closes it on daemon shutdown, `poll()` returns null
  (no work items — the trigger is purely a lifetime host for the
  server).
- `previewRunTrigger` — starts the Preview run at Cli start (see
  "reactor-project service"); no work items.

The `spec-*` commands (`spec-list`, `spec-get`, `spec-create`,
`spec-update`, `spec-extract`, `spec-generate`, `spec-delete`) read and
write the Home drive and nothing else: `helpers/embedded-drive.ts` →
`requireSpecDrive(ctx)` always resolves the reactor of the process the
command runs in and refuses a run with no drive to reach. Typed in a second
terminal they run in the project's running Studio (see the top of this
document); with `VETRA_SWITCHBOARD_URL` or `--local` the calling process
attaches itself. `spec-update` reads its actions through
`context.readStdin` and resolves `--from` against the caller's folder, so
both work from the caller's terminal.
`preview-models` runs in the Studio too; in a process that holds no service
instance (`--local`) it trusts the inspector's report while the Preview's
run record is live (`previewModels` in `helpers/preview-inspector.ts`). The node and relationship writes are in
`helpers/spec-drive-sync.ts` (one drive write at a time per process).
`getEmbeddedDrive(ctx)` is for optional writes: it gates on `ctx.folders`
(wired once the reactor is attached with a personal drive, absent in
one-shot CLI), so a one-shot run never attaches for them. Lookups by type
in the drive (the product document, chat sessions) use
`findInDrive` there: `client.find({ type, parentId })` over every page.

### Services

- `reactor-project` — the Preview run (see "reactor-project service").
  Persistent state at
  `<data folder>/.ph/vetra/services/reactor-project/<instance>.json` (under
  the project, so two projects never list each other's; read by
  `reactor-project-ps` and projected over the local API). State an earlier
  version left in `~/.ph/vetra/services/` is not read: clint reports it once
  and leaves it in place. The
  run's own record is
  `<project>/.ph/run/@powerhousedao/vetra-cli/preview.json`.

## Boot sequence

`ph run studio` first starts the switchboard (its run record waits for the
seeded `studio` drive), then Connect, each in its own process, then the
Cli in the compound's process (the foreground member) at `run`, handed the
drive URL
(`<switchboard>/d/studio`) and the two members as service instances. The
stack's record is `.ph/run/studio.json`. Then clint's start sequence, run by
the Cli runner (`runCli`):

1. **Reactor** — with a drive address, the runner's `RunOptions.reactor`
   attaches to the switchboard (`attachDefaultReactor` with
   `configureReactor.remote`): the GraphQL client, the `Home` drive found
   by name or created, the subscriptions bridged. No embedded switchboard,
   Connect or reactor store starts. Without an address, `create` throws as
   soon as something asks for the reactor.
2. **Routine** — trigger loop starts. `previewServerTrigger.setup()`
   binds the local API HTTP + SSE server on `127.0.0.1` and an OS port,
   writes `studio.config.json` naming it, and subscribes to the framework
   event-bus for `service:*` events.
   The other triggers (`chatSessionWatchTrigger`,
   `driveLayoutTrigger`, `runtimeSpecSyncTrigger`) begin polling.
   `studioUrlTrigger` prints `Vetra Studio: <url>/d/<drive id>` (non-TTY)
   or opens it in the browser: `<url>` is the ready Connect member's
   `endpoints.connect` (`http://127.0.0.1:8090/`). Connect does not
   redirect `/` to the drive: open the printed `/d/<id>` URL.

The stack ends when the Cli ends, on Ctrl-C, or on
`ph run studio --stop`, which stops the members in reverse order.

`previewRunTrigger` starts the `reactor-project` instance of the workdir
without waiting for it.

### Auto-start of reactor-project

The Cli starts the Preview run at its own start. A page that shows the
preview also recovers a stopped one. When
`/resolve` returns `project-stopped` for a session's target, the
browser-side `useResolvedPreview` hook fires `POST /start` once
without any user click. SSE drives the resulting state
transitions back into the pane: `service:starting` →
`service:ready` → the pane refetches `/resolve` and lands on `ready`.
No call of the SPA names a project: its targets are a document, a drive or
the project's home, and its Specify and Deploy views show the one project
(the specs at the Home drive's root, the workdir's package).

Guards: the browser tracks "auto-started" to avoid
spinning on a persistent failure (e.g. port conflict surfaces as
`service:failed`; the guard is only cleared when state reaches
`ready`, so the next stop will auto-recover). The server side is
idempotent independently: a `POST /start` for an already-running
workdir returns `already-running` and never spawns a duplicate.

The agent's existing `reactor-project-start` tool is still the
chat-visible way to start a project; auto-start is the recovery
path. Agent-driven starts produce visible chat history, which is
preferable for normal flow.

## Preview flow

What happens when the agent previews an in-progress document model.

```
  agent
    │
    ▼
  spec-create / spec-update
    └─→ Studio drive  (the spec document, the only copy)
    │
    ▼
  spec-generate
    └─→ reactor-project tree (project source)
            ↓ (the Preview run, Vite HMR)
        reactor-project picks up new document model
    │
    ▼
  spec-preview-create({ projectId, specSlug })
    → reactor-project Switchboard GraphQL mutation
    → returns { documentId, driveId }
```

The Studio page shows the Preview Connect's drive root in its Test panel
(see "The Studio page"); it does not follow a session's document.

The chain has no package boundary: specs are generated directly into
the reactor-project's source tree, the dev-mode Switchboard registers
the document model from the project's own code, the dev-mode Connect
imports the editor via Vite. No `npm publish`, no local registry, no
dynamic bundle swap.

## Browser addresses

The Cli runs no proxy. What the browser reaches, all on this machine:

- **The Studio** — Connect on 8090, which proxies the Studio switchboard's
  paths (see "Hosts"). Connect does not redirect `/`; the Cli prints
  `<connect>/d/<drive id>`.
- **A panel in its own tab** — the same page with Connect's `embed=1`
  (which Connect keeps across navigation): `<connect>/d/<drive>/<document>?embed=1`
  is that spec document's editor only, `<connect>/d/<drive>?embed=1` the
  explorer without the bar, and `<connect>/d/<drive>?embed=1&panel=test`
  the Test / Preview page.
- **Test frame** — the Preview Connect on 8092 directly, at the address
  `/resolve?home=1` gives (`http://localhost:8092/d/<preview drive>?embed=1`).
- **The Labs screenshots** — `<connect>/vetra-labs/<page>.jpg`.
- **The local API** — `http://127.0.0.1:<OS port>` directly, the address
  `<connect>/studio.config.json` names.
- **BUILD iframe** — the project's own Connect at the URL its run record
  gives (`/resolve` `url`, e.g. `http://localhost:3001/d/<preview drive>/<doc>?embed=1`);
  an app drive's `driveUrl` parameter is the project switchboard's
  `/d/<id>` directly.

One public origin (a cloud Studio, or a remote browser) needs a proxy in
front of these: C2/C4 (a Preview host with fixed ports) or Labs.

## Filesystem layout

```
vetra-cli/                     ← package root, @powerhousedao/vetra-cli
├── ARCHITECTURE.md            ← you are here
├── HANDOFF.md                 ← open work + next steps
├── package.json               ← exports (./cli included), bin `vetra`
├── pnpm-workspace.yaml        ← catalog (the Powerhouse line), overrides
├── powerhouse.manifest.json
├── index.ts                   ← package export: models, editors, processors
├── document-models/           ← studio-product (spec documents: @powerhousedao/vetra)
├── editors/
│   └── vetra-studio/          ← drive editor (Vetra Studio); shell/ is the page
├── processors/
├── subgraphs/
├── prompts/                   ← agent sections and skill templates
├── cloud-client/              ← Vetra Cloud environment client
├── bin/vetra.mjs              ← the `vetra` bin over dist/node/cli
├── hosts/                     ← switchboard, connect, cli, studio and studio-signed (compounds)
│   └── connect/labs/          ← Vetra Labs screenshots Connect serves
├── cli/
│   ├── index.ts               ← ./cli: startup guards, `cli`, `ensureModelAuth`
│   ├── src/
│   │   ├── main.ts            ← `pnpm dev` entry (runCli)
│   │   ├── cli.ts             ← defineCli + configureReactor (remote)
│   │   ├── framework.ts       ← config + secrets schemas, document registry
│   │   ├── lazy.ts            ← lazyCommand / lazyTrigger (start path)
│   │   ├── running-studio.ts  ← the project's running Studio, from its run record
│   │   ├── constants.ts       ← default PH version
│   │   ├── agents/agent.ts    ← Mastra agent factory
│   │   ├── preview-server/    ← vetra local API (resolve/start/events)
│   │   ├── commands/          ← spec-*, reactor-project-*, spec-preview-*
│   │   ├── services/
│   │   │   └── reactor-project.ts
│   │   └── triggers/
│   │       ├── preview-server.ts   ← hosts the local API
│   │       ├── drive-layout.ts     ← the Home drive's layout folders
│   │       └── runtime-spec-sync.ts ← model specs from the Preview's report
│   ├── tests/                 ← vitest project `cli` (the app's tests: `app`)
│   ├── scripts/               ← build-assets.ts (ph-version), dev scripts
│   └── e2e/                   ← playwright suite
└── dist/                      ← ph build output; dist/connect from build:connect

<project>/.ph/vetra/           ← the Studio switchboard's stores
                                 (reactor-storage, read-storage)
<project>/.ph/vetra-signed/    ← the same for hosts/studio-signed
<project>/.ph/run/             ← run records of the studio stack
<workdir>/.ph/vetra/           ← the Cli's own files (helpers/studio-paths.ts):
                                 clint's store (.mastra, logs), the agent's
                                 identity (agent/.keypair.json, .renown.json),
                                 downloads/ (files from chat messages), the
                                 local API's preview-trusted-keys.json,
                                 codegen.lock, launch.json, product-drive.json,
                                 upgrade-existing.json
<project>/.ph/vetra/services/  ← clint's service state (reactor-project)
```

Nothing the Cli writes on its own account lands at `.ph/` root, where the
switchboard keeps its instance key (`.keypair.json`) and the store its
pseudonym (`.pseudonym.json`). The user's `ph login` is in the home folder.

## Open gaps

These are limitations of the current direction; not bugs.

- **The product layer keeps the cloud workspace layout.** Launch,
  versions, rollback and the upgrade of older Studios read the project
  folders of a cloud Studio's workspace (immediate subfolders with a
  `powerhouse.config.json`, `launch/workspace-layout.ts`) until Labs
  replaces them (D8). A Studio inside one project has none, and the layer
  is unreachable there (no product document).

- **Agent doesn't see runtime failures.** Service errors, workflow
  failures, and reactor-project crashes surface in the terminal via
  log handlers; the agent's input channels (chat session + Mastra
  thread) don't yet receive them. A `pushAgentNotice(message)` primitive
  in clint, or a per-turn pending-context queue, would close it.

- **Studio-mode parity.** Connect runs static (the package's prebuilt
  bundle), served by its own host from B2. The live preview path is
  reactor-project + Vite HMR, not dynamic package loading.

- **The remote path.** A cloud Studio's signing is checked by unit tests
  only: `hosts/studio-signed` runs a `v2-required` switchboard, but its
  check needs a wallet and has not been run (see "The signed check"). Its
  tab's owner calls carry a bearer bound to `studioOrigin`, which only unit
  tests check so far. `ReactorContext.client` is typed as the full client, so a call
  `GraphQLReactorClient` lacks would fail at run time, not in the type
  check; the Cli, the spec sync and clint's folder operations use only
  calls both clients have. No product starts in a Studio inside a project
  (no idea screen) and the page shows none; one whose story starts with work
  from before versions still launches through `ensureProductTarget` (`product/upgrade-existing.ts`).
  That layer commits, tags and deletes files in the workdir, so it must not
  run on an existing repository until git managed by Studio is designed. The attach carries the switchboard's
  attachment service: the chat watch reads a message's file through its
  conversation (`documentId`), which the switchboard admits by the reference
  it indexes from the message's `AttachmentRef` field
  (`cli/e2e/tests/studio-chat.spec.ts` runs it).

- **Hosts.** The package's form (`ph run @powerhousedao/vetra-cli/studio`
  from another project) reads the package's own build, config file,
  packages and identity folder (see "Hosts"); no trust check limits which
  package a project may take hosts from. Connect's `/` shows its own start
  page, not the Studio drive: the printed `/d/<id>` URL is the Studio.

The live publish path — `commands/reactor-project/publish.ts` and
`publish-status.ts` — is unaffected: those are the deploy-flow tools that
publish a Reactor package to the remote registry via the agent's Renown
token (see "Renown identity → Publish path" above).
