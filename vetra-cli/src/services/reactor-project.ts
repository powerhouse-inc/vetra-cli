import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { checkWorkdir, checkCommand, checkPort, type LifecycleHook } from '@powerhousedao/ph-clint';
import { defineService } from '../framework.js';
import { REACTOR_PROJECT_CONNECT_PROXY_PATH } from '../constants.js';

// Normalize a proxy publicUrl into the mount base path: '' for an
// unset/invalid/root URL, else a leading-slash no-trailing-slash form
// ('/myagent'). Mirrors ph-clint's proxy deriveBasePath so the dev-server
// --base lines up with the prefix stripBase removes before route matching.
export function deployBasePath(publicUrl: string | undefined): string {
  const raw = publicUrl?.trim();
  if (!raw) return '';
  try {
    return new URL(raw).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// Resolved mount base for the embedded proxy. Set at boot by
// proxyBasePathHook from the layered-config proxyPublicUrl (flag > config
// file > VETRA_PROXY_PUBLIC_URL env) — the same value ph-clint mounts the
// proxy under — so a config-file-supplied publicUrl reaches the dev-server
// --base too. ServiceDefinition.command only receives params, so the value
// is captured here rather than read from context at command-build time.
let resolvedDeployBasePath = '';

export function proxyBasePathHook(): LifecycleHook {
  return {
    name: 'reactor-project-proxy-base',
    onInit(ctx) {
      resolvedDeployBasePath = deployBasePath(
        ctx.config.proxyPublicUrl as string | undefined,
      );
      return {};
    },
  };
}

const reactorProjectParams = z.object({
  watch: z.boolean().default(true).describe('Enable file watching'),
  connectPort: z.coerce.number().optional().describe('Connect Studio port'),
  switchboardPort: z.coerce.number().optional().describe('Vetra Switchboard port'),
});

export const reactorProject = defineService({
  id: 'reactor-project',
  name: 'Reactor Project',
  description: 'Vetra Studio server for reactor project development',
  command: (params) => {
    const parts = ['ph', 'vetra'];
    if (params?.watch !== false) parts.push('--watch');
    if (typeof params?.connectPort === 'number') parts.push('--connect-port', String(params.connectPort));
    if (typeof params?.switchboardPort === 'number') parts.push('--switchboard-port', String(params.switchboardPort));
    // Serve Connect under the deploy base + proxy prefix so the BUILD iframe
    // loads it through the embedded proxy; Vite emits all asset URLs under
    // this base. Under a proxy subpath the base carries that prefix too, so
    // the captured upstream matches the path stripBase forwards.
    parts.push('--base', `${resolvedDeployBasePath}${REACTOR_PROJECT_CONNECT_PROXY_PATH}/`);
    // Bind the Vite Connect dev server to IPv4 loopback. Without this it binds
    // [::1] only; ph-clint builds the proxy upstream from the captured Local:
    // URL via new URL(), whose `localhost` host resolves IPv4-first to
    // 127.0.0.1 where nothing then listens -> ECONNREFUSED. env.HOST is not
    // applied to the dev server, so the --host flag is the only lever.
    parts.push('--host', '127.0.0.1');
    return parts.join(' ');
  },
  paramsSchema: reactorProjectParams,
  env: (config, params) => ({
    // PORT workaround: https://github.com/powerhouse-inc/powerhouse/commit/9830c16b
    PORT: String(params?.switchboardPort),
    HOST: '0.0.0.0',
    NODE_ENV: 'development',
    NODE_OPTIONS: '--max-old-space-size=4096',
  }),
  readiness: {
    patterns: [
      {
        // Capture the full URL including the --base path: the proxy forwards
        // the matched prefix verbatim, so the upstream must carry the base.
        // With --host 127.0.0.1 Vite prints the bound IP rather than
        // `localhost`, so accept either host.
        name: 'vetra-studio',
        pattern: /Local:\s*(http:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*)/,
        captures: { 'vetra-studio': { group: 1, type: 'website' } },
      },
      {
        name: 'vetra-drive-url',
        pattern: /(?<!Preview )Drive URL:\s*(https?:\/\/[^\s]+)/,
        captures: { 'vetra-drive-url': { group: 1, type: 'other' } },
      },
      {
        name: 'vetra-preview-drive-url',
        pattern: /Preview Drive URL:\s*(https?:\/\/[^\s]+)/,
        captures: { 'vetra-preview-drive-url': { group: 1, type: 'other' } },
      },
      {
        name: 'vetra-switchboard',
        pattern: /Switchboard:\s*(https?:\/\/[^\s]+)/,
        captures: { 'vetra-switchboard': { group: 1, type: 'api-graphql' } },
      },
      {
        name: 'mcp-server',
        pattern: /MCP server available at (https?:\/\/[^\s]+)/,
        captures: { 'mcp-server': { group: 1, type: 'api-mcp' } },
      },
    ],
    timeout: 90_000,
  },
  preflight: [
    checkWorkdir(
      (cwd) =>
        fs.existsSync(path.join(cwd, 'powerhouse.config.ts')) ||
        fs.existsSync(path.join(cwd, 'powerhouse.config.json')),
      'Not a Reactor Package project',
      'Run reactor-project-start --workdir <project>, or create one with /reactor-project-init',
    ),
    checkCommand('ph', {
      hint: 'Install the Powerhouse CLI: npm install -g ph-cli',
    }),
    checkPort((ctx) => (ctx.params?.connectPort as number) ?? 3000, 'Connect Studio'),
    checkPort((ctx) => (ctx.params?.switchboardPort as number) ?? 4001, 'Switchboard'),
  ],
  shutdown: { signal: 'SIGTERM', timeout: 10_000 },
  restart: { enabled: true, maxRetries: 3, delay: 5_000 },
  projectScanner: {
    isProjectFolder: (p) =>
      fs.existsSync(path.join(p, 'powerhouse.config.json')) ||
      fs.existsSync(path.join(p, 'powerhouse.config.ts')),
  },
});
