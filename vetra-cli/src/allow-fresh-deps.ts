// pnpm v11 gates freshly-published deps (minimumReleaseAge=1440); vetra tracks
// fresh dev/rc releases, so disable it for child pnpm (ph init / codegen).
if (process.env.PNPM_CONFIG_MINIMUM_RELEASE_AGE === undefined) {
  // Env overrides the scaffold's pnpm-workspace.yaml; an explicit value is kept.
  process.env.PNPM_CONFIG_MINIMUM_RELEASE_AGE = "0";
}
