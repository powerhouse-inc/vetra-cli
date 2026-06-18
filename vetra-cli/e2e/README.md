# vetra-cli e2e (Playwright)

A **seeded** end-to-end test. It boots a self-contained vetra-cli studio against
a fresh **empty** workdir, drives the chat UI to build a todo-list, and asserts
the generated editor renders inside the BUILD-pane iframe — exercising the whole
loop: chat → agent → tools → reactor → studio.

The agent is made **deterministic** without an API key: a replay `AgentProvider`
(`src/agents/replay-agent.ts`, gated by `VETRA_REPLAY_FIXTURE`) replays a recorded
tool sequence, executing the **real** commands against the live reactor. Only tool
*selection* is canned — every reactor mutation, file write, codegen run, and
project start happens for real.

Isolated from the unit suite: lives under `e2e/` (not `tests/`), so jest, the
`eslint src tests` lint, and the `tsc` build all skip it.

## Run

Requires `ph` (the `ph-cmd` package) on PATH — the studio's reactor-project
shells out to it. A dev machine usually has it; CI installs it. The booted
studio's `ensure-ph` hook will otherwise try to install it at boot.

```sh
cd vetra-cli
pnpm test:e2e:install   # one-time: download the chromium browser
pnpm test:e2e           # boots an empty studio, builds, asserts — then tears it down
pnpm test:e2e:report    # open the HTML report after a run
```

`global-setup` spawns `tsx src/main.ts --workdir <tmp>` with `VETRA_REPLAY_FIXTURE`
set and `HOME` pointed at `<tmp>/home`, waits for the `Vetra Studio: …` line, and
records the studio URL + drive id in `.cache/run.json`; `global-teardown` SIGINTs the
studio for graceful shutdown, then kills any leftover service recorded under that
isolated `HOME`, and removes the temp workdir.

### Isolation & parallelism

The run is self-contained and a good citizen — it won't disturb your other work:

- **Isolated HOME.** ph-clint roots service state at `HOME/.ph/<cli>`, so the studio
  is booted with `HOME=<tmp>/home`. The run never reads or rewrites your real
  `~/.ph`, and teardown only kills processes recorded under its own `HOME`.
- **Auto-assigned ports.** `VETRA_PROXY_PORT=0` lets the proxy pick a free port (the
  test reads the actual URL from the boot log), and the studio's switchboard/connect
  scan up from their derived defaults (`portRange`). So a run coexists with another
  `vetra` studio and won't claim fixed ports.
- **Warm inner install.** The cold `ph init` install inside the studio shares a
  pnpm store at `$TMPDIR/vetra-e2e-pnpm-store` (overridable via
  `npm_config_store_dir`), kept out of the isolated `HOME` so it stays warm.

Caveat — running **two seeded e2es at the exact same time on one host** still
collides: the nested reactor-project's BUILD dev server binds fixed `3000`/`4001`
with a preflight gate. For genuinely simultaneous local runs, run each in a
container (the same image the prod-close leg builds), which namespaces ports + HOME.

## Configure

| Env | Default | Meaning |
| --- | --- | --- |
| `VETRA_FIXTURE` | `todo-list` | Fixture under `e2e/fixtures/` (`<name>.json` + `<name>.replay.json`) |
| `VETRA_E2E_BASE_URL` | _(unset)_ | Attach to a studio you started yourself (already in replay mode); skips boot |
| `VETRA_BASE_URL` + `VETRA_DRIVE_ID` | _(unset)_ | Point the test at a known studio without `.cache/run.json` |

### Fixtures

- `<name>.json` — the assertion fixture: the kickoff `prompt`, the `replay` filename,
  and the expected `preview` (project, document name, items with completed state).
- `<name>.replay.json` — the ordered tool steps the replay agent executes. Generate
  it from a recorded session log:

  ```sh
  node e2e/fixtures/build-replay-fixture.mjs <path-to>/VetraAgent/<session>.md
  ```

  It keeps the build-affecting calls (drops reads/skills and any call whose recorded
  result errored), in order, with full inputs.

The bundled assertions (`New todo…` placeholder, `Add` button, `<li>` checkboxes) are
specific to the todo-list editor; a different build needs both fixture files **and**
matching assertions in the spec.

## Fail-fast

The whole point of the replay path is a fast, deterministic failure. When a replay
step errors, the agent stops and logs `[replay] … ERROR` to `.cache/studio.log`; the
spec tails that file while waiting for the preview and throws on the first error
line, so a broken build fails in seconds rather than waiting out the preview timeout.
The reactor-project's BUILD route on the run's own proxy (`/_proxy/routes`) is the
readiness signal — it also confirms the test is driving *this* run's instance.

## CI

`.github/workflows/e2e.yml` runs two legs of one matrix job in parallel on PRs:

- **source** — this seeded suite, from source (`pnpm test:e2e`).
- **docker** — prod-close (`lab/ci/run-prodclose-e2e.sh`): build the prod image and
  assert the studio HTTP contract.

`fail-fast` cancels the in-progress sibling on the first failure, so the fast source
check aborts the slow docker build when it trips. On failure the source leg uploads
the Playwright report + `studio.log`.
