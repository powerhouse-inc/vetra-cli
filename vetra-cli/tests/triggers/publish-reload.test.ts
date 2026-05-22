import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  parseCdnPackageSpec,
  publishReloadTrigger,
  createPublishReloadTrigger,
  type SseSubscriber,
} from '../../src/triggers/publish-reload.js';

// ── parseCdnPackageSpec ────────────────────────────────────────────

describe('parseCdnPackageSpec', () => {
  it('parses an unscoped package with version', () => {
    expect(
      parseCdnPackageSpec(
        'http://localhost:8765/-/cdn/vetra-app@1.0.0/node/document-models/index.mjs',
      ),
    ).toEqual({ packageName: 'vetra-app', version: '1.0.0' });
  });

  it('parses a scoped package with version', () => {
    expect(
      parseCdnPackageSpec(
        'http://localhost:8765/-/cdn/@powerhousedao/codegen@6.0.0-dev.1/index.mjs',
      ),
    ).toEqual({ packageName: '@powerhousedao/codegen', version: '6.0.0-dev.1' });
  });

  it('returns unknown version for unscoped package without @version', () => {
    expect(
      parseCdnPackageSpec('http://x/-/cdn/vetra-app/node/index.mjs'),
    ).toEqual({ packageName: 'vetra-app', version: 'unknown' });
  });

  it('returns undefined for URLs without /-/cdn/', () => {
    expect(parseCdnPackageSpec('http://x/foo/bar.js')).toBeUndefined();
  });

  it('parses spec at end of URL (no trailing path)', () => {
    expect(parseCdnPackageSpec('http://x/-/cdn/vetra-app@1.2.3')).toEqual({
      packageName: 'vetra-app',
      version: '1.2.3',
    });
  });
});

// ── poll() — happy path + failure surfacing ────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

function mockResponse(init: MockResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => init.body ?? '',
    headers,
  } as unknown as Response;
}

interface Handlers {
  installedPackages?: () => MockResponseInit;
  uninstallPackage?: (name: string) => MockResponseInit;
  installPackage?: (name: string) => MockResponseInit;
  connectReload?: () => MockResponseInit;
}

function installFetchMock(handlers: Handlers): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/__packages') && init?.method === 'POST') {
      return mockResponse(handlers.connectReload?.() ?? { status: 204 });
    }
    // GraphQL endpoint — branch on operation in the body
    const bodyStr =
      typeof init?.body === 'string' ? init.body : '';
    if (bodyStr.includes('installedPackages')) {
      return mockResponse(
        handlers.installedPackages?.() ?? {
          body: '{"data":{"Packages":{"installedPackages":[]}}}',
        },
      );
    }
    if (bodyStr.includes('uninstallPackage')) {
      const parsed = JSON.parse(bodyStr) as {
        variables?: { name?: string };
      };
      return mockResponse(
        handlers.uninstallPackage?.(parsed.variables?.name ?? '') ?? {
          body: '{"data":{"Packages":{"uninstallPackage":true}}}',
        },
      );
    }
    if (bodyStr.includes('installPackage')) {
      const parsed = JSON.parse(bodyStr) as {
        variables?: { name?: string };
      };
      return mockResponse(
        handlers.installPackage?.(parsed.variables?.name ?? '') ?? {
          body: '{"data":{"Packages":{"installPackage":{"documentModelsLoaded":[]}}}}',
        },
      );
    }
    throw new Error(`unmocked fetch call: ${url} body=${bodyStr.slice(0, 80)}`);
  }) as unknown as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

interface HarnessOptions {
  installed?: { name: string }[];
  connectEndpoint?: string | null;
  switchboardUrl?: string | null;
}

interface Harness {
  ctx: any;
  emitted: { event: string; data: unknown }[];
  logs: { level: string; msg: string }[];
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const emitted: { event: string; data: unknown }[] = [];
  const logs: { level: string; msg: string }[] = [];
  const log = {
    debug: (m: string) => logs.push({ level: 'debug', msg: m }),
    info: (m: string) => logs.push({ level: 'info', msg: m }),
    warn: (m: string) => logs.push({ level: 'warn', msg: m }),
    error: (m: string) => logs.push({ level: 'error', msg: m }),
    level: 'debug' as const,
  };

  const connectEndpoint = opts.connectEndpoint;
  const services = {
    list: jest.fn((id?: string) => {
      if (id === 'local-registry') {
        return [
          {
            id: 'local-registry',
            instanceId: 'i',
            status: 'ready',
            endpoints: { 'local-registry': 'http://reg' },
          },
        ];
      }
      if (connectEndpoint === null) return [];
      return [
        {
          id: 'vetra-studio',
          instanceId: 'i',
          status: 'ready',
          endpoints: {
            'connect-studio':
              connectEndpoint ?? 'http://connect.local',
          },
        },
      ];
    }),
  };

  const reactor = async () =>
    opts.switchboardUrl === null
      ? undefined
      : ({
          switchboardUrl:
            opts.switchboardUrl ?? 'http://switchboard/graphql',
        } as any);

  const ctx: any = {
    context: {
      workdir: '/tmp/test',
      services,
      log,
      emit: (event: string, data: unknown) =>
        emitted.push({ event, data }),
    },
    state: {
      pending: [],
      registryUrl: 'http://reg',
      // Pre-set unsubscribe so poll's lazy setup() retry is skipped —
      // we don't want the SSE subscriber's fetch to fire in tests.
      unsubscribe: () => {},
      connectSubscribedUrl:
        opts.connectEndpoint ?? 'http://connect.local',
      unsubscribeConnect: () => {},
    },
    reactor,
  };
  return { ctx, emitted, logs };
}

describe('publishReloadTrigger.poll', () => {
  let fetchMock: ReturnType<typeof installFetchMock>;
  afterEach(() => {
    fetchMock?.restore();
  });

  it('returns null and does no work when no events are pending', async () => {
    fetchMock = installFetchMock({});
    const { ctx, emitted } = makeHarness();
    const result = await publishReloadTrigger.poll(ctx);
    expect(result).toBeNull();
    expect(emitted).toEqual([]);
    // No mutation calls fired
    const mutations = fetchMock.calls.filter((c) =>
      typeof c.init?.body === 'string'
        ? c.init.body.includes('installPackage') ||
          c.init.body.includes('uninstallPackage')
        : false,
    );
    expect(mutations).toEqual([]);
  });

  it('reloads switchboard and broadcasts connect on a pending publish event', async () => {
    fetchMock = installFetchMock({
      installedPackages: () => ({
        body: '{"data":{"Packages":{"installedPackages":[{"name":"vetra-app@0.9.0"}]}}}',
      }),
      connectReload: () => ({
        status: 204,
        headers: { 'x-reload-clients': '2' },
      }),
    });
    const { ctx, emitted, logs } = makeHarness();
    ctx.state.pending.push({ packageName: 'vetra-app', version: '1.0.0' });

    const result = await publishReloadTrigger.poll(ctx);
    expect(result).toBeNull();
    expect(emitted).toEqual([]);

    const bodies = fetchMock.calls
      .map((c) => (typeof c.init?.body === 'string' ? c.init.body : ''))
      .join(' || ');
    expect(bodies).toContain('uninstallPackage');
    expect(bodies).toContain('"name":"vetra-app@0.9.0"');
    expect(bodies).toContain('installPackage');
    expect(bodies).toContain('"name":"vetra-app@1.0.0"');

    const reloadCall = fetchMock.calls.find((c) =>
      c.url.endsWith('/__packages'),
    );
    expect(reloadCall).toBeDefined();
    expect(reloadCall!.init?.method).toBe('POST');

    expect(
      logs.some(
        (l) =>
          l.level === 'debug' &&
          l.msg.includes('switchboard reloaded vetra-app@1.0.0'),
      ),
    ).toBe(true);
  });

  it('emits package:reload-failed for switchboard target when installPackage returns GraphQL errors', async () => {
    fetchMock = installFetchMock({
      installPackage: () => ({
        body: '{"errors":[{"message":"Unexpected identifier"}]}',
      }),
    });
    const { ctx, emitted } = makeHarness();
    ctx.state.pending.push({ packageName: 'vetra-app', version: '1.0.3' });

    await publishReloadTrigger.poll(ctx);

    const failures = emitted.filter((e) => e.event === 'package:reload-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toEqual({
      packageName: 'vetra-app',
      version: '1.0.3',
      target: 'switchboard',
      error: 'Unexpected identifier',
    });
  });

  it('emits package:reload-failed for connect target when POST /__packages returns non-ok', async () => {
    fetchMock = installFetchMock({
      connectReload: () => ({ ok: false, status: 500, body: '' }),
    });
    const { ctx, emitted } = makeHarness();
    ctx.state.pending.push({ packageName: 'vetra-app', version: '1.0.0' });

    await publishReloadTrigger.poll(ctx);

    const failures = emitted.filter((e) => e.event === 'package:reload-failed');
    expect(failures).toHaveLength(1);
    expect((failures[0].data as any).target).toBe('connect');
    expect((failures[0].data as any).error).toContain('500');
  });

  it('subscribes to the registry SSE on setup and appends publish events to state.pending', async () => {
    fetchMock = installFetchMock({});
    const handlers: Record<
      string,
      (eventName: string, data: string) => void
    > = {};
    const subscribe: SseSubscriber = (url, onEvent) => {
      handlers[url] = onEvent;
      return () => {};
    };
    const trigger = createPublishReloadTrigger({ subscribe });

    const { ctx } = makeHarness();
    // setup() expects an empty starting state; reset pre-set fixtures
    ctx.state = (trigger.state as () => any)();

    await trigger.setup!(ctx);
    expect(ctx.state.registryUrl).toBe('http://reg');
    const sseHandler = handlers['http://reg/-/events'];
    expect(sseHandler).toBeDefined();

    sseHandler('publish', JSON.stringify({ packageName: 'a', version: '1' }));
    sseHandler('publish', JSON.stringify({ packageName: 'b', version: '2' }));
    sseHandler('publish', 'not-json'); // should be ignored
    sseHandler('other', JSON.stringify({ packageName: 'c', version: '3' })); // wrong event

    expect(ctx.state.pending).toEqual([
      { packageName: 'a', version: '1' },
      { packageName: 'b', version: '2' },
    ]);
  });

  it('subscribes to Connect /__packages SSE and emits package:reload-failed on package-error', async () => {
    fetchMock = installFetchMock({});
    const handlers: Record<
      string,
      (eventName: string, data: string) => void
    > = {};
    const subscribe: SseSubscriber = (url, onEvent) => {
      handlers[url] = onEvent;
      return () => {};
    };
    const trigger = createPublishReloadTrigger({ subscribe });

    const { ctx, emitted, logs } = makeHarness({
      connectEndpoint: 'http://connect.local',
    });
    // Force the connect subscriber to wire up by clearing the pre-set match.
    ctx.state.connectSubscribedUrl = undefined;
    ctx.state.unsubscribeConnect = undefined;

    await trigger.poll(ctx);

    const connectHandler = handlers['http://connect.local/__packages'];
    expect(connectHandler).toBeDefined();
    expect(ctx.state.connectSubscribedUrl).toBe('http://connect.local');

    connectHandler(
      'package-error',
      JSON.stringify({
        message: 'TypeError: boom',
        filename:
          'http://reg/-/cdn/vetra-app@1.0.1/node/document-models/index.mjs',
      }),
    );

    const failures = emitted.filter((e) => e.event === 'package:reload-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toEqual({
      packageName: 'vetra-app',
      version: '1.0.1',
      target: 'connect',
      error: 'TypeError: boom',
    });
    expect(
      logs.some(
        (l) =>
          l.level === 'error' &&
          l.msg.includes('connect package error (vetra-app@1.0.1)'),
      ),
    ).toBe(true);
  });

  it('falls back to "unknown" spec when package-error filename is not a CDN URL', async () => {
    fetchMock = installFetchMock({});
    const handlers: Record<
      string,
      (eventName: string, data: string) => void
    > = {};
    const subscribe: SseSubscriber = (url, onEvent) => {
      handlers[url] = onEvent;
      return () => {};
    };
    const trigger = createPublishReloadTrigger({ subscribe });

    const { ctx, emitted } = makeHarness({
      connectEndpoint: 'http://connect.local',
    });
    ctx.state.connectSubscribedUrl = undefined;
    ctx.state.unsubscribeConnect = undefined;

    await trigger.poll(ctx);
    handlers['http://connect.local/__packages'](
      'package-error',
      JSON.stringify({ message: 'oops', filename: 'http://example/foo.js' }),
    );

    const failures = emitted.filter((e) => e.event === 'package:reload-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toEqual({
      packageName: 'unknown',
      version: 'unknown',
      target: 'connect',
      error: 'oops',
    });
  });

  it('ignores non-package-error SSE events from Connect', async () => {
    fetchMock = installFetchMock({});
    const handlers: Record<
      string,
      (eventName: string, data: string) => void
    > = {};
    const subscribe: SseSubscriber = (url, onEvent) => {
      handlers[url] = onEvent;
      return () => {};
    };
    const trigger = createPublishReloadTrigger({ subscribe });

    const { ctx, emitted } = makeHarness({
      connectEndpoint: 'http://connect.local',
    });
    ctx.state.connectSubscribedUrl = undefined;
    ctx.state.unsubscribeConnect = undefined;

    await trigger.poll(ctx);
    handlers['http://connect.local/__packages'](
      'reload',
      JSON.stringify({}),
    );
    handlers['http://connect.local/__packages'](
      'package-error',
      'not-json',
    );

    expect(emitted.filter((e) => e.event === 'package:reload-failed')).toEqual(
      [],
    );
  });

  it('returns null without reload work when switchboard URL is not available', async () => {
    fetchMock = installFetchMock({});
    const { ctx, emitted } = makeHarness({ switchboardUrl: null });
    ctx.state.pending.push({ packageName: 'vetra-app', version: '1.0.0' });

    const result = await publishReloadTrigger.poll(ctx);
    expect(result).toBeNull();
    expect(emitted).toEqual([]);
    // Pending event is consumed (splice happens before the switchboard check),
    // but no fetch calls should have fired for mutations.
    const mutationCalls = fetchMock.calls.filter((c) =>
      typeof c.init?.body === 'string'
        ? c.init.body.includes('installPackage')
        : false,
    );
    expect(mutationCalls).toEqual([]);
  });
});
