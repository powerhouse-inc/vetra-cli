# vetra-app

The Powerhouse **Reactor package** that backs [Vetra CLI](../README.md). This is
where the document models, editors, processors, and subgraphs the agent works
with actually live. The embedded Reactor loads this package, and Vetra Studio
renders its editors live in the browser.

## Layout

| Path | What it is |
|---|---|
| `document-models/` | Document model definitions (state schemas, operations, reducers). |
| `editors/` | React editor components for document types and drive-apps. |
| `processors/` | Reactor processors. |
| `subgraphs/` | GraphQL subgraphs exposed via Switchboard. |
| `specs/` | Source specs the codegen reads. |
| `powerhouse.manifest.json` | Package manifest the Reactor loads. |

## Develop

From the **repo root**, install once and run the agent — it loads this package
automatically:

```sh
pnpm install
pnpm dev
```

Common package-local tasks:

```sh
pnpm --filter vetra-app generate     # regenerate code from specs
pnpm --filter vetra-app build        # typecheck + ph-cli build
pnpm --filter vetra-app typecheck
pnpm --filter vetra-app test
```

See the root [README](../README.md) and [ARCHITECTURE.md](../ARCHITECTURE.md)
for how this package fits into the runtime.

## License

[AGPL-3.0](../LICENSE).
</content>
