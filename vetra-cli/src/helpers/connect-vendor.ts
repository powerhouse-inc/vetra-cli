/**
 * Opt-in toggle for Connect's dev-server "externalize vendor" lever.
 *
 * builder-tools' devReactImportmapPlugin reads `PH_CONNECT_EXTERNALIZE_VENDOR`
 * ("1") at module scope: when set it prebuilds Connect's heavy stable deps into
 * a static vendor bundle and externalizes them from the project reactor's Vite
 * dev server, so the long-lived server never dep-optimizes them (~1 GB
 * resident). `PH_CONNECT_VENDOR_EXTRA` (comma-separated specifiers) adds extra
 * libs to vendor.
 *
 * The reactor-project service spawns that dev server (`ph vetra`). This gates
 * the toggle on a vetra-level signal so a harness can flip it without a
 * code change, default OFF. Returns the child-env keys ONLY when armed; an
 * empty object otherwise, so the spawned env is byte-identical to before when
 * the signal is unset (turning it on by default is a separate decision).
 *
 * Signals (any truthy-"1" value arms it):
 *   VETRA_CONNECT_EXTERNALIZE_VENDOR  vetra alias (preferred)
 *   PH_CONNECT_EXTERNALIZE_VENDOR     framework-native passthrough
 */
function isArmed(): boolean {
  return (
    process.env.VETRA_CONNECT_EXTERNALIZE_VENDOR === '1' ||
    process.env.PH_CONNECT_EXTERNALIZE_VENDOR === '1'
  );
}

export function connectExternalizeVendorEnv(): Record<string, string> {
  if (!isArmed()) return {};
  const env: Record<string, string> = { PH_CONNECT_EXTERNALIZE_VENDOR: '1' };
  const extra = process.env.PH_CONNECT_VENDOR_EXTRA?.trim();
  if (extra) env.PH_CONNECT_VENDOR_EXTRA = extra;
  return env;
}
