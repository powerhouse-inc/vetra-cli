import fs from 'node:fs';
import path from 'node:path';

const FEDERATION_PKGS = ['@apollo/gateway', '@apollo/subgraph'] as const;

/** Versions of `pkg` linked under the project's pnpm store dir. */
export function installedVersions(projectPath: string, pkg: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(projectPath, 'node_modules', '.pnpm'));
  } catch {
    // npm/yarn scaffold, or no install yet — nothing to pin.
    return [];
  }
  const prefix = `${pkg.replace('/', '+')}@`;
  const versions = new Set<string>();
  for (const entry of entries) {
    if (entry.startsWith(prefix)) versions.add(entry.slice(prefix.length).split('_')[0]);
  }
  return [...versions].sort();
}

/**
 * A fresh scaffold has no lockfile, so `@apollo/subgraph` resolves ahead of the
 * `@apollo/gateway` reactor-api settles on. Schemas built by the newer subgraph
 * fail composition in the older gateway, which drops EVERY subgraph
 * ("doc.definitions is not iterable") and leaves the switchboard with no query
 * root type. Returns the gateway version both should be pinned to, or undefined
 * when the pair already agrees or gateway is absent/ambiguous.
 */
export function federationPinTarget(projectPath: string): string | undefined {
  const gateway = installedVersions(projectPath, '@apollo/gateway');
  if (gateway.length !== 1) return undefined;
  const subgraph = installedVersions(projectPath, '@apollo/subgraph');
  if (subgraph.length === 1 && subgraph[0] === gateway[0]) return undefined;
  return gateway[0];
}

/** Rewrites a pnpm-workspace.yaml so both federation packages pin to `version`. */
export function withFederationOverrides(yaml: string, version: string): string {
  const pins = FEDERATION_PKGS.map((pkg) => `  "${pkg}": "${version}"`).join('\n');
  const kept = yaml
    .split('\n')
    .filter(
      (line) =>
        !FEDERATION_PKGS.some((pkg) =>
          [`"${pkg}":`, `'${pkg}':`, `${pkg}:`].some((k) => line.trim().startsWith(k)),
        ),
    )
    .join('\n');
  if (/^overrides:[ \t]*$/m.test(kept)) {
    return kept.replace(/^overrides:[ \t]*$/m, `overrides:\n${pins}`);
  }
  return `${kept.replace(/\n*$/, '\n')}overrides:\n${pins}\n`;
}
