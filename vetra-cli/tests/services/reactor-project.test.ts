import { describe, it, expect } from '@jest/globals';
import type { LifecycleInitContext } from '@powerhousedao/ph-clint';
import {
  deployBasePath,
  proxyBasePathHook,
  reactorProject,
} from '../../src/services/reactor-project.js';

// ── deployBasePath ─────────────────────────────────────────────────

describe('deployBasePath', () => {
  it('returns "" when unset', () => {
    expect(deployBasePath(undefined)).toBe('');
    expect(deployBasePath('')).toBe('');
    expect(deployBasePath('   ')).toBe('');
  });

  it('returns "" for a root-path URL', () => {
    expect(deployBasePath('https://studio.example.com')).toBe('');
    expect(deployBasePath('https://studio.example.com/')).toBe('');
  });

  it('returns the pathname without trailing slashes', () => {
    expect(deployBasePath('https://example.com/myagent')).toBe('/myagent');
    expect(deployBasePath('https://example.com/myagent/')).toBe('/myagent');
    expect(deployBasePath('https://example.com/a/b///')).toBe('/a/b');
  });

  it('returns "" for an invalid URL', () => {
    expect(deployBasePath('not a url')).toBe('');
  });
});

// ── proxyBasePathHook → command --base ─────────────────────────────

function initHook(proxyPublicUrl: string | undefined): void {
  void proxyBasePathHook().onInit({
    config: { proxyPublicUrl },
  } as unknown as LifecycleInitContext);
}

function baseFlag(): string {
  const { command } = reactorProject;
  if (typeof command !== 'function') throw new Error('expected command function');
  const match = /--base (\S+)/.exec(command());
  if (!match?.[1]) throw new Error('--base flag not found in command');
  return match[1];
}

describe('reactor-project --base', () => {
  it('uses the proxy prefix alone when no publicUrl is configured', () => {
    initHook(undefined);
    expect(baseFlag()).toBe('/reactor-project/vetra-studio/');
  });

  it('prefixes the resolved publicUrl pathname', () => {
    initHook('https://example.com/myagent/');
    expect(baseFlag()).toBe('/myagent/reactor-project/vetra-studio/');
    initHook(undefined);
  });
});

describe('reactor-project --renown-namespace', () => {
  it('shares the Studio Renown namespace with the preview Connect', () => {
    const { command } = reactorProject;
    if (typeof command !== 'function')
      throw new Error('expected command function');
    const cmd = command({ config: {} } as unknown as Parameters<typeof command>[0]);
    expect(cmd).toContain('--renown-namespace vetra-studio');
  });
});

// ── reactorProject env — public preview reactor ────────────────────

describe('reactor-project env — public preview reactor', () => {
  it('disables auth so the preview reactor boots OPEN', () => {
    const { env } = reactorProject;
    if (typeof env !== 'function') throw new Error('expected env function');
    const e = env({ params: { switchboardPort: 4001 } } as Parameters<typeof env>[0]);
    expect(e.AUTH_ENABLED).toBe('false');
    expect(e.DOCUMENT_PERMISSIONS_ENABLED).toBe('false');
    expect(e.PORT).toBe('4001');
  });

  it('clears admin/credential/protection hygiene keys', () => {
    const { env } = reactorProject;
    if (typeof env !== 'function') throw new Error('expected env function');
    const e = env({ params: { switchboardPort: 4001 } } as Parameters<typeof env>[0]);
    expect(e.DEFAULT_PROTECTION).toBe('false');
    expect(e.SKIP_CREDENTIAL_VERIFICATION).toBe('false');
    expect(e.ADMINS).toBe('');
  });
});
