/**
 * Vetra Studio environment detection. A cloud environment that runs Vetra Studio
 * has the published `vetra-cli` package installed. Those environments host the
 * Studio itself and must never be used as package-deploy targets.
 */

/** The package a Vetra Studio environment runs. Its presence marks an env as a
 * Studio host. */
export const STUDIO_ENV_PACKAGE = "vetra-cli";

/** True when an environment's installed package names include the Studio package
 * — i.e. the env runs Vetra Studio and is not a deploy target. Accepts any
 * iterable so callers can pass an array or a `Map`'s keys directly. */
export function isStudioEnvironment(packageNames: Iterable<string>): boolean {
  for (const name of packageNames) {
    if (name.trim() === STUDIO_ENV_PACKAGE) return true;
  }
  return false;
}
