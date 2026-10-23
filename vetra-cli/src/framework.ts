/**
 * Per-CLI typed framework binding.
 *
 * This file is USER-OWNED. ph-clint-cli emits it once at project
 * creation and never overwrites it afterwards — edit `configSchema`
 * and `secretsSchema` freely.
 *
 * Typed factories (`defineCommand`, `defineTrigger`, ...) and the
 * document `registry` come from `framework.gen.ts`, which IS
 * regenerated whenever the spec's `documentTypes` list changes.
 */
import { z } from 'zod';
import { createTypes } from '@powerhousedao/ph-clint';
import { registry } from './framework.gen.js';
import { DEFAULT_PH_VERSION } from './constants.js';

/** Fallback chain when VETRA_MODEL_FALLBACKS is unset or blank (a model is never its own fallback). */
export const DEFAULT_MODEL_FALLBACKS = ['deepseek/deepseek-v4.1-flash', 'google/gemini-3.1-flash-lite'] as const;

export const configSchema = z.object({
  // @clint:begin framework-config
  model: z.string().default('anthropic/claude-sonnet-4.6').describe('OpenRouter model id for the main agent (env VETRA_MODEL)'),
  agentLogging: z.boolean().default(false).describe('Enable agent conversation logging'),
  memoryModel: z.string().default('deepseek/deepseek-v4.1-flash-1017').describe('Model for observational memory (background compression of long chat histories)'),
  phVersion: z.string().optional().describe(`Powerhouse version for new reactor projects (defaults to ${DEFAULT_PH_VERSION})`),
  reactorProjectClonePath: z.string().optional().describe('Path to a pre-scaffolded reactor-project. When set, reactor-project-init clones it via `ph init --clone` (fast path). Typically baked into container images.'),
  registryUrl: z.string().optional().describe('Registry URL to use when publishing packages. When unset, resolution falls through to PH_REGISTRY_URL, powerhouse.config.json, then the registry implied by the cloud switchboard (prod: https://registry.vetra.io). A missing registry is an error, never a dev default'),
  cloudSwitchboardUrl: z.string().optional().describe('Vetra Cloud switchboard base URL the deploy commands talk to (env VETRA_CLOUD_SWITCHBOARD_URL); required for cloud commands, no default'),
  cloudRenownUrl: z.string().optional().describe('Renown identity service URL for the cloud login flow (defaults to https://www.renown.id)'),
  // @clint:end framework-config

  githubAppSlug: z
    .string()
    .default('vetra-studio')
    .describe('GitHub App slug; the bot commits as <slug>[bot] (env VETRA_GITHUB_APP_SLUG)'),
  environmentId: z
    .string()
    .optional()
    .describe(
      'The studio environment document id used to scope the GitHub repo (env VETRA_ENVIRONMENT_ID)',
    ),
  packageManager: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.enum(['npm', 'pnpm']).optional().catch(undefined),
    )
    .describe(
      'Package manager for `ph init` on fresh reactor projects. Unset: prefer pnpm when installed, else npm. An unrecognized value is ignored (falls back to inference). The --clone fast path always uses pnpm (ph requires it). Env VETRA_PACKAGE_MANAGER.',
    ),
  subagentModel: z
    .string()
    .optional()
    .describe('OpenRouter model id for the sub-agents (env VETRA_SUBAGENT_MODEL); defaults to the main model'),
  modelFallbacks: z
    .string()
    .optional()
    .describe(
      `Comma list of up to 3 OpenRouter fallback model ids (env VETRA_MODEL_FALLBACKS). Unset or blank: ${DEFAULT_MODEL_FALLBACKS.join(', ')}; \`none\`: no fallbacks`,
    ),
  llmAllowDataCollection: z
    .preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean())
    .default(false)
    .describe('Allow OpenRouter providers that may collect prompt data (env VETRA_LLM_ALLOW_DATA_COLLECTION); default deny'),
});

export const secretsSchema = z.object({
  // @clint:begin framework-secrets
  anthropicApiKey: z.string().optional().describe('anthropic API key'),
  // @clint:end framework-secrets
  openrouterApiKey: z
    .string()
    .optional()
    .describe('OpenRouter API key (env VETRA_OPENROUTER_API_KEY; a bare OPENROUTER_API_KEY is read too)'),
});

export type Config = z.infer<typeof configSchema> &
  z.infer<typeof secretsSchema>;

const fullConfigSchema = configSchema.extend(secretsSchema.shape);

export const {
  defineCommand,
  defineTrigger,
  defineService,
  createDocumentChangeTrigger,
} = createTypes({
  configSchema: fullConfigSchema,
  registry,
});

export { registry } from './framework.gen.js';
export type { Registry } from './framework.gen.js';
