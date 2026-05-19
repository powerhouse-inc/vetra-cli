import { z } from 'zod';
import { checkPort } from '@powerhousedao/ph-clint';
import { defineService } from '../framework.js';

const localRegistryParams = z.object({
  port: z.coerce.number().optional().describe('Port to listen on (overrides config.localRegistryPort)'),
});

/**
 * Local Powerhouse package registry — runs `ph-registry` (Verdaccio + CDN +
 * SSE webhooks). The agent publishes Reactor packages here via
 * `reactor-project-publish --registry http://localhost:<port>`, and the
 * Switchboard / Connect instance dynamically loads new versions.
 *
 * Storage and CDN cache live under `<workdir>/.ph/registry/*` (the service
 * spawns with cwd=workdir, so relative paths resolve there).
 */
export const localRegistry = defineService({
  id: 'local-registry',
  name: 'Local Package Registry',
  description: 'Verdaccio-based npm registry + Powerhouse CDN for published Reactor packages',
  command: (params) => {
    const port = (params?.port as number | undefined) ?? 8080;
    return [
      'ph-registry',
      '--port', String(port),
      '--storage-dir', '.ph/registry/storage',
      '--cdn-cache-dir', '.ph/registry/cdn-cache',
    ].join(' ');
  },
  paramsSchema: localRegistryParams,
  env: () => ({
    NODE_ENV: 'development',
  }),
  readiness: {
    patterns: [
      {
        name: 'registry',
        pattern: /Powerhouse Registry running on (https?:\/\/[^\s]+)/,
        captures: { 'local-registry': { group: 1, type: 'api-rest' } },
      },
    ],
    timeout: 30_000,
  },
  preflight: [
    checkPort(
      (ctx) => (ctx.params?.port as number | undefined) ?? 8080,
      'Local Package Registry',
    ),
  ],
  shutdown: { signal: 'SIGTERM', timeout: 10_000 },
  restart: { enabled: true, maxRetries: 3, delay: 5_000 },
});
