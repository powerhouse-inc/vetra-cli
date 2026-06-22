import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  checkWorkdir,
  checkCommand,
  checkPort,
  type LifecycleHook,
  type ServiceInstanceStatus,
  type ServiceProxyRouteSpec,
} from '@powerhousedao/ph-clint';
import { defineService } from '../framework.js';
import {
  REACTOR_PROJECT_CONNECT_PROXY_PATH,
  REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH,
} from '../constants.js';
import { reactorProjectNodeOptions } from '../helpers/node-memory.js';
import { connectExternalizeVendorEnv } from '../helpers/connect-vendor.js';

// Readiness wait for the inner `ph vetra` dev server; env-overridable for slow
// runners where cold Vite start exceeds the default.
const READINESS_TIMEOUT_MS =
  Number(process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS) || 90_000;

// Switchboard mount relative to the `/reactor-project/` service prefix that
// ph-clint prepends to every proxyRoutes spec (e.g. 'switchboard').
const SWITCHBOARD_MOUNT = REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH.replace(
  /^\/reactor-project\//,
  '',
);

/**
 * Mirror the embedded `/switchboard/*` proxy scheme for the project's
 * switchboard, under /reactor-project/switchboard. The `/d/`-aligned route
 * shape makes the proxy send the X-Forwarded-Prefix the switchboard needs to
 * announce proxied follow-up endpoints, so the drive URLs ph vetra rebases
 * via --drives-public-base resolve through the proxy.
 *
 * A service proxyRoutes hook so ph-clint re-asserts these on every
 * `service:ready` — including auto-restart and boot-adoption — alongside the
 * readiness-capture routes, not just on the start command.
 */
export function switchboardProxyRoutes(
  instance: ServiceInstanceStatus,
): ServiceProxyRouteSpec[] {
  const sbUrl = instance.endpoints?.['vetra-switchboard'];
  const mcpUrl = instance.endpoints?.['mcp-server'];
  if (!sbUrl) return [];

  const base = SWITCHBOARD_MOUNT;
  return [
    { prefix: `${base}/d/`, upstream: new URL('/d/', sbUrl), ws: false },
    { prefix: `${base}/graphql`, upstream: new URL('/graphql', sbUrl), ws: false },
    {
      prefix: `${base}/attachments/`,
      upstream: new URL('/attachments/', sbUrl),
      ws: false,
    },
    ...(mcpUrl
      ? [{ prefix: `${base}/mcp`, upstream: new URL('/mcp', mcpUrl), ws: true }]
      : []),
  ];
}

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

// Configured public proxy URL (no trailing slash), '' when none is set.
// Takes precedence over the live proxy origin for --drives-public-base.
let resolvedProxyPublicUrl = '';

export function proxyBasePathHook(): LifecycleHook {
  return {
    name: 'reactor-project-proxy-base',
    onInit(ctx) {
      const raw = (ctx.config.proxyPublicUrl as string | undefined)?.trim();
      resolvedProxyPublicUrl = '';
      if (raw) {
        try {
          new URL(raw);
          resolvedProxyPublicUrl = raw.replace(/\/+$/, '');
        } catch {
          // invalid publicUrl — fall through to the proxy origin
        }
      }
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
  proxyPublicUrl: z
    .string()
    .url()
    .optional()
    .describe('Live public proxy origin for advertised drive URLs'),
});

export const reactorProject = defineService({
  id: 'reactor-project',
  name: 'Reactor Project',
  description: 'Vetra Studio server for reactor project development',
  command: ({params, config}) => {
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
    // Advertise drives via the public proxy origin (localhost switchboard is
    // unreachable remotely). publicUrl > live origin from start > default port.
    const proxyBase =
      resolvedProxyPublicUrl ||
      (params?.proxyPublicUrl as string | undefined)?.replace(/\/+$/, '') ||
      `http://localhost:${Number((config as Record<string, unknown>).proxyPort) || 8090}`;
    parts.push(
      '--drives-public-base',
      `${proxyBase}${REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH}`,
    );
    return parts.join(' ');
  },
  paramsSchema: reactorProjectParams,
  proxyRoutes: switchboardProxyRoutes,
  env: ({params}) => ({
    // PORT workaround: https://github.com/powerhouse-inc/powerhouse/commit/9830c16b
    PORT: String(params?.switchboardPort),
    HOST: '0.0.0.0',
    NODE_ENV: 'development',
    // Heap cap is per-fork; each ph vetra child inherits it. See node-memory.ts.
    NODE_OPTIONS: reactorProjectNodeOptions(),
    // Opt-in: serve Connect's heavy stable deps from a prebuilt vendor bundle so
    // the long-lived Vite dev server never dep-optimizes them (~1 GB resident).
    // Off unless a vetra-cli-level signal is set. See connect-vendor.ts.
    ...connectExternalizeVendorEnv(),
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
    timeout: READINESS_TIMEOUT_MS,
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
      hint: 'Install the Powerhouse CLI: npm install -g ph-cmd',
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
