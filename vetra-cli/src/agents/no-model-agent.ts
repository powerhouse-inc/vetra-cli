import type { AgentProvider, StreamChunk } from '@powerhousedao/ph-clint';
import { VETRA_AGENT_IMAGE } from './agent-image.js';

/** Spec "No key means connect a model": verbatim. */
export const NO_MODEL_MESSAGE =
  'No model is connected. Open Studio settings → Model to use the Vetra budget or connect your OpenRouter account.';

/**
 * The agent of a Studio without an OpenRouter key. It always serves — warm pool
 * pods too, so the observability poller sees READY — and answers every chat
 * with NO_MODEL_MESSAGE. It never calls an LLM. A key arriving later (claim,
 * provisionStudioLlm) restarts the pod through Reloader, and the next boot
 * builds the real agent.
 */
export function createNoModelAgent(): AgentProvider {
  return {
    id: 'vetra-agent',
    name: 'Vetra Agent',
    image: VETRA_AGENT_IMAGE,
    async *stream() {
      yield { type: 'text-delta', text: NO_MODEL_MESSAGE } satisfies StreamChunk;
    },
  };
}
