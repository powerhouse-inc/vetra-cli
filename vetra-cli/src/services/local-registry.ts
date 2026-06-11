import { checkPort } from '@powerhousedao/ph-clint';
import { defineService } from '../framework.js';
import { LOCAL_REGISTRY_PORT } from '../constants.js';
import { localRegistryNodeOptions } from '../helpers/node-memory.js';

/**
 * Local Powerhouse package registry — runs `ph-registry` (Verdaccio + CDN +
 * SSE webhooks). The agent publishes Reactor packages here, and the
 * Switchboard / Connect instance dynamically loads new versions.
 *
 * Storage and CDN cache live under `<workdir>/.ph/registry/*` (the service
 * spawns with cwd=workdir, so relative paths resolve there).
 */

export const localRegistry = defineService({
  id: 'local-registry',
  name: 'Local Package Registry',
  description: 'Verdaccio-based npm registry + Powerhouse CDN for published Reactor packages',
  command: () => [
    'ph-registry',
    '--port', String(LOCAL_REGISTRY_PORT),
    '--storage-dir', '.ph/registry/storage',
    '--cdn-cache-dir', '.ph/registry/cdn-cache',
  ].join(' '),
  env: () => ({
    NODE_ENV: 'development',
    NODE_OPTIONS: localRegistryNodeOptions(),
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
    checkPort(() => LOCAL_REGISTRY_PORT, 'Local Package Registry'),
  ],
  shutdown: { signal: 'SIGTERM', timeout: 10_000 },
  restart: { enabled: true, maxRetries: 3, delay: 5_000 },
});
