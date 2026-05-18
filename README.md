# vetra-cli

A ph-clint-based project.

## Getting started

```sh
pnpm install
pnpm dev
```

## Enabled features

- **Powerhouse**: on (Connect)
  - Switchboard: on
  - Connect: on
- **Mastra agent**: on
- **Routine loop**: on

## Regenerate

Toggle features or update metadata in `.ph/ph-clint-cli/project-spec.json`,
then re-run `ph-clint clint-project-regen` to regenerate.

## Split layout

This project is split into `vetra-cli-cli/` (the CLI) and `vetra-cli-app/` (the Powerhouse reactor package).

Run `ph init` inside `vetra-cli-app/` to scaffold the reactor package layout (document-models, editors, manifest, etc.).
