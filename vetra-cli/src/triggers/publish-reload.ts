/**
 * publish-reload trigger
 *
 * Watches the local-registry's SSE publish stream and, for each running
 * reactor-project instance, force-reloads the just-published package on
 * both Switchboard (server) and Connect (browser).
 *
 *   Switchboard:  Packages.uninstallPackage(name) + Packages.installPackage(
 *                 name: "<name>@<version>", registryUrl)
 *                 — the versioned spec changes the CDN URL so Node's ESM
 *                 import cache misses; otherwise reinstall would return the
 *                 module already cached against the unversioned URL.
 *
 *   Connect:      ws://<connect-host>/ with subprotocol "vite-hmr", send
 *                 {"type":"full-reload"}. ph vetra runs Connect under a vite
 *                 dev server, and the HMR WS accepts arbitrary clients on
 *                 default-config local dev (no hmr token).
 *
 * In a default-dev reactor, auth_enabled defaults to false and the admin
 * gate degenerates to () => true (see reactor-api graphql-manager.ts:486),
 * so the unauthenticated POST works. If a project enables auth the trigger
 * will need an admin token — out of scope here.
 */
import { defineTrigger } from '../framework.js';

interface PublishEvent {
  packageName: string;
  version: string;
}

async function postGraphql(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: boolean; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.text();
  return { ok: res.ok, body };
}

async function reloadOnSwitchboard(
  switchboardUrl: string,
  registryUrl: string,
  event: PublishEvent,
  log: { debug: (m: string) => void; warn: (m: string) => void } | undefined,
): Promise<void> {
  // Uninstall first; if not installed yet this is a no-op (mutation returns false).
  const uninstall = await postGraphql(
    switchboardUrl,
    `mutation Uninstall($name: String!) { Packages { uninstallPackage(name: $name) } }`,
    { name: event.packageName },
  );
  if (!uninstall.ok) {
    log?.warn(
      `[publish-reload] uninstallPackage(${event.packageName}) failed: ${uninstall.body.slice(0, 200)}`,
    );
  }

  const install = await postGraphql(
    switchboardUrl,
    `mutation Install($name: String!, $registryUrl: String) {
       Packages {
         installPackage(name: $name, registryUrl: $registryUrl) {
           documentModelsLoaded
         }
       }
     }`,
    { name: `${event.packageName}@${event.version}`, registryUrl },
  );
  if (!install.ok) {
    log?.warn(
      `[publish-reload] installPackage(${event.packageName}@${event.version}) failed: ${install.body.slice(0, 200)}`,
    );
    return;
  }
  log?.debug(
    `[publish-reload] switchboard reloaded ${event.packageName}@${event.version}`,
  );
}

async function reloadOnConnect(
  connectUrl: string,
  event: PublishEvent,
  log: { debug: (m: string) => void; warn: (m: string) => void } | undefined,
): Promise<void> {
  // Convert http(s):// → ws(s)://.
  const wsUrl = connectUrl.replace(/^http/, 'ws');
  try {
    const ws = new WebSocket(wsUrl, ['vite-hmr']);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 3_000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'full-reload' }));
        ws.close();
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('ws error'));
      });
    });
    log?.debug(
      `[publish-reload] connect full-reload sent for ${event.packageName}@${event.version}`,
    );
  } catch (err) {
    log?.warn(
      `[publish-reload] connect full-reload failed (${wsUrl}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

interface TriggerState {
  pending: PublishEvent[];
  sseUrl: string | undefined;
  unsubscribe: (() => void) | undefined;
}

export const publishReloadTrigger = defineTrigger<TriggerState>({
  id: 'publish-reload',
  type: 'condition',
  state: () => ({ pending: [], sseUrl: undefined, unsubscribe: undefined }),

  async setup(ctx) {
    const log = ctx.context.log;
    const services = ctx.context.services;
    if (!services) {
      log?.debug('[publish-reload] no service manager — skipping');
      return;
    }
    const instance = services.list('local-registry').find(
      (s) => s.status === 'ready' && s.endpoints?.['local-registry'],
    );
    if (!instance) {
      // local-registry not running yet. Poll will retry once it's up.
      log?.debug('[publish-reload] local-registry not ready yet');
      return;
    }
    const registryUrl = instance.endpoints!['local-registry'];
    const sseUrl = `${registryUrl.replace(/\/$/, '')}/-/events`;
    ctx.state.sseUrl = registryUrl;
    log?.debug(`[publish-reload] subscribing to ${sseUrl}`);

    const source = new EventSource(sseUrl);
    source.addEventListener('publish', (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as PublishEvent;
        ctx.state.pending.push(event);
      } catch {
        // ignore malformed event
      }
    });
    source.addEventListener('error', () => {
      // EventSource auto-reconnects; nothing to do here.
    });
    ctx.state.unsubscribe = () => source.close();
  },

  async teardown(ctx) {
    ctx.state.unsubscribe?.();
  },

  async poll(ctx) {
    // Lazy late-bind: if setup ran before local-registry was ready, retry here.
    if (!ctx.state.unsubscribe) {
      await this.setup?.(ctx);
    }

    if (ctx.state.pending.length === 0) return null;

    const events = ctx.state.pending.splice(0, ctx.state.pending.length);
    const services = ctx.context.services;
    const log = ctx.context.log;
    if (!services || !ctx.state.sseUrl) return null;

    const registryUrl = ctx.state.sseUrl;
    const reactorInstances = services.list('reactor-project').filter(
      (s) => s.status === 'ready' && s.endpoints,
    );

    for (const event of events) {
      for (const instance of reactorInstances) {
        const switchboardGraphql = instance.endpoints?.['vetra-switchboard'];
        const connectUrl = instance.endpoints?.['vetra-studio'];
        if (switchboardGraphql) {
          await reloadOnSwitchboard(switchboardGraphql, registryUrl, event, log);
        }
        if (connectUrl) {
          await reloadOnConnect(connectUrl, event, log);
        }
      }
    }

    // Side-effect-only trigger; no agent work item.
    return null;
  },
});
