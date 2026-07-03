/**
 * Links a deploy-target environment to the Vetra Studio that produced it.
 *
 * When the deploy commands run inside a studio, `config.environmentId`
 * (VETRA_ENVIRONMENT_ID) is the studio's own environment document id. Stamping
 * it onto the target env's `studioInstanceId` is what lets vetra.to group the
 * env under its studio on /user/products — "where the package from the studio
 * is installed."
 *
 * Kept dependency-free (structural types, no controller/framework imports) so
 * the decision logic is trivially unit-testable.
 */

/** The minimal controller surface this touches; the real EnvironmentController
 * satisfies it. */
export interface StudioInstanceStampable {
  state: { global: { studioInstanceId?: string | null } };
  setStudioInstance(input: { studioInstanceId: string }): void;
}

/** The slice of framework config this reads. */
export interface StudioInstanceConfig {
  /** The studio's own env document id (VETRA_ENVIRONMENT_ID); unset outside a studio. */
  environmentId?: string;
}

/**
 * Stamp `studioInstanceId` on the target env. No-op when:
 *  - not running inside a studio (`environmentId` unset/blank), or
 *  - the env is already linked to this studio (avoids a redundant action).
 */
export function stampStudioInstance(
  controller: StudioInstanceStampable,
  config: StudioInstanceConfig,
): void {
  const studioInstanceId = config.environmentId?.trim();
  if (!studioInstanceId) return;
  if (controller.state.global.studioInstanceId === studioInstanceId) return;
  controller.setStudioInstance({ studioInstanceId });
}
