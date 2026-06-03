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
import { LOCAL_REGISTRY_URL, DEFAULT_PH_VERSION } from './constants.js';

export const configSchema = z.object({
  // @clint:begin framework-config
  model: z.string().default('anthropic/claude-sonnet-4-5').describe('LLM model for the main agent (sub-agent models come from the spec)'),
  agentLogging: z.boolean().default(false).describe('Enable agent conversation logging'),
  memoryModel: z.string().default('anthropic/claude-haiku-4-5').describe('Model for observational memory (background compression of long chat histories)'),
  phVersion: z.string().optional().describe(`Powerhouse version for new reactor projects (defaults to ${DEFAULT_PH_VERSION})`),
  reactorProjectClonePath: z.string().optional().describe('Path to a pre-scaffolded reactor-project. When set, reactor-project-init clones it via `ph init --template` (fast path). Typically baked into container images.'),
  registryUrl: z.string().default(LOCAL_REGISTRY_URL).describe('Registry URL to use when publishing packages (defaults to the local-registry service)'),
  registryUsername: z.string().optional().describe('Username for registry authentication'),
  registryEmail: z.email().optional().describe('Email for registry authentication'),
  // @clint:end framework-config
});

export const secretsSchema = z.object({
  // @clint:begin framework-secrets
  anthropicApiKey: z.string().optional().describe('anthropic API key'),
  registryPassword: z.string().optional().describe('Password for registry authentication'),
  // @clint:end framework-secrets
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
