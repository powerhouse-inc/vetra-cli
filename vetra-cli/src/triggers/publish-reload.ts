/**
 * publish-reload trigger
 *
 * Watches the local-registry's SSE publish stream and, on each published
 * version, force-reloads the just-published package on the CLI's *embedded*
 * Connect/Switchboard — the single shared instance configured via
 * `cli.configureReactor`.
 *
 *   Switchboard:  Packages.uninstallPackage on every spec that matches the
 *                 just-published name ("<name>" or "<name>@*"), then
 *                 Packages.installPackage with the version-qualified spec
 *                 ("<name>@<version>"). The version suffix is essential —
 *                 it changes the CDN URL so Node's ESM import cache misses;
 *                 otherwise reinstall would return the already-cached
 *                 module.
 *
 *   Connect:      POST <connect-host>/__reload. The static-server and the
 *                 studio (vite) modes both expose this endpoint and inject
 *                 a small EventSource client into the served HTML, so any
 *                 connected SPA tab refreshes on broadcast.
 *
 * In a default-dev reactor, auth_enabled defaults to false and the admin
 * gate degenerates to () => true (see reactor-api graphql-manager.ts:486),
 * so the unauthenticated POST works. An auth-enabled reactor would need an
 * admin token — out of scope.
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
  // The reactor stores packages under the literal name passed to installPackage,
  // including the version suffix ("vetra-app@1.0.0"). To re-install with a new
  // version we have to uninstall every previously-installed spec for the same
  // package, since uninstall(name: "vetra-app") wouldn't match the keyed entry
  // "vetra-app@1.0.0".
  const listed = await postGraphql(
    switchboardUrl,
    `{ Packages { installedPackages { name } } }`,
    {},
  );
  if (listed.ok) {
    try {
      const parsed = JSON.parse(listed.body) as {
        data?: { Packages?: { installedPackages?: { name: string }[] } };
      };
      const installed = parsed.data?.Packages?.installedPackages ?? [];
      const targets = installed
        .map((p) => p.name)
        .filter(
          (n) => n === event.packageName || n.startsWith(`${event.packageName}@`),
        );
      for (const target of targets) {
        const res = await postGraphql(
          switchboardUrl,
          `mutation Uninstall($name: String!) { Packages { uninstallPackage(name: $name) } }`,
          { name: target },
        );
        if (!res.ok) {
          log?.warn(
            `[publish-reload] uninstallPackage(${target}) failed: ${res.body.slice(0, 200)}`,
          );
        }
      }
    } catch (err) {
      log?.warn(
        `[publish-reload] installedPackages parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
  const reloadUrl = `${connectUrl.replace(/\/$/, '')}/__reload`;
  try {
    const res = await fetch(reloadUrl, { method: 'POST' });
    if (!res.ok) {
      log?.warn(
        `[publish-reload] POST ${reloadUrl} returned ${res.status} for ${event.packageName}@${event.version}`,
      );
      return;
    }
    const clients = res.headers.get('x-reload-clients');
    log?.debug(
      `[publish-reload] connect reload broadcast for ${event.packageName}@${event.version}` +
        (clients ? ` (${clients} client${clients === '1' ? '' : 's'})` : ''),
    );
  } catch (err) {
    log?.warn(
      `[publish-reload] connect reload failed (${reloadUrl}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

interface TriggerState {
  pending: PublishEvent[];
  registryUrl: string | undefined;
  unsubscribe: (() => void) | undefined;
}

/**
 * Subscribe to the registry's SSE endpoint via a fetch stream. Avoids the
 * global `EventSource` (not available on every Node runtime — undici exposes
 * one but Node doesn't always promote it as global). Reconnects with a short
 * backoff on stream errors / disconnects.
 */
function subscribeToSSE(
  url: string,
  onEvent: (eventName: string, data: string) => void,
  log: { debug: (m: string) => void; warn: (m: string) => void } | undefined,
): () => void {
  let aborted = false;
  const controller = new AbortController();

  async function connect(): Promise<void> {
    while (!aborted) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          log?.warn(`[publish-reload] SSE connect ${res.status}`);
          await sleep(2_000);
          continue;
        }
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buf = '';
        let eventName = 'message';
        let dataLines: string[] = [];
        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).replace(/\r$/, '');
            buf = buf.slice(nl + 1);
            if (line === '') {
              if (dataLines.length > 0) {
                onEvent(eventName, dataLines.join('\n'));
              }
              eventName = 'message';
              dataLines = [];
              continue;
            }
            if (line.startsWith(':')) continue; // comment
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') eventName = value;
            else if (field === 'data') dataLines.push(value);
          }
        }
      } catch (err) {
        if (aborted) return;
        log?.debug(
          `[publish-reload] SSE error, reconnecting: ${err instanceof Error ? err.message : String(err)}`,
        );
        await sleep(2_000);
      }
    }
  }

  void connect();

  return () => {
    aborted = true;
    controller.abort();
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const publishReloadTrigger = defineTrigger<TriggerState>({
  id: 'publish-reload',
  type: 'condition',
  state: () => ({ pending: [], registryUrl: undefined, unsubscribe: undefined }),

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
      log?.debug('[publish-reload] local-registry not ready yet');
      return;
    }
    const registryUrl = instance.endpoints!['local-registry'];
    const sseUrl = `${registryUrl.replace(/\/$/, '')}/-/events`;
    ctx.state.registryUrl = registryUrl;
    log?.debug(`[publish-reload] subscribing to ${sseUrl}`);

    const close = subscribeToSSE(
      sseUrl,
      (eventName, data) => {
        if (eventName !== 'publish') return;
        try {
          const event = JSON.parse(data) as PublishEvent;
          ctx.state.pending.push(event);
        } catch {
          // ignore malformed event
        }
      },
      log,
    );
    ctx.state.unsubscribe = close;
  },

  async teardown(ctx) {
    ctx.state.unsubscribe?.();
  },

  async poll(ctx) {
    // Lazy late-bind: if setup ran before local-registry was ready, retry now.
    if (!ctx.state.unsubscribe) {
      await this.setup?.(ctx);
    }
    if (ctx.state.pending.length === 0) return null;

    const events = ctx.state.pending.splice(0, ctx.state.pending.length);
    const services = ctx.context.services;
    const log = ctx.context.log;
    const registryUrl = ctx.state.registryUrl;
    if (!services || !registryUrl) return null;

    const reactor = await ctx.reactor();
    const switchboardUrl = reactor?.switchboardUrl;
    if (!switchboardUrl) {
      log?.debug('[publish-reload] embedded switchboard URL not available');
      return null;
    }

    // Connect's URL is captured by ph-clint as the `connect-studio` endpoint
    // on a service named `${cliName}-studio` (e.g. vetra-studio). It isn't
    // surfaced on ReactorContext, so look it up via the service manager.
    const connectUrl = services
      .list()
      .find((s) => s.status === 'ready' && s.endpoints?.['connect-studio'])
      ?.endpoints?.['connect-studio'];

    for (const event of events) {
      await reloadOnSwitchboard(switchboardUrl, registryUrl, event, log);
      if (connectUrl) {
        await reloadOnConnect(connectUrl, event, log);
      } else {
        log?.debug('[publish-reload] embedded connect URL not available');
      }
    }

    // Side-effect-only trigger; no agent work item.
    return null;
  },
});
