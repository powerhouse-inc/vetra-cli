import { formatLines } from '../helpers/cli-errors.js';

/** The credential states resolveClaudeAgentModel() can return. */
export type ResolvedCredentialKind = 'none' | 'api-key' | 'subscription';

/**
 * Enforce the "this environment requires a credential" gate. When `required`
 * and no credential resolved (`kind === 'none'`), throw a clear, user-facing
 * error instead of silently degrading to the demo agent. Warm-pool studio envs
 * set requireApiKey=true so an unclaimed / key-less pod refuses to do agent
 * work — making "no key" an explicit gate rather than the network policy.
 */
export function assertCredentialIfRequired(
  kind: ResolvedCredentialKind,
  required: boolean,
): void {
  if (required && kind === 'none') {
    throw new Error(
      formatLines(
        'Vetra agent not provisioned: no Anthropic API key is available.',
        'This environment requires a key. If you just claimed it, wait a few seconds and retry.',
      ),
    );
  }
}
