import {
  CLOUD_BASE_DOMAIN,
  describePendingChange,
  pendingChanges,
  type EnvironmentSummary,
  type OperationLike,
  type VetraCloudEnvironmentGlobalState,
} from "@powerhousedao/vetra-cloud-client";

/** `vetra env list` row. */
export interface EnvListItem {
  id: string;
  name: string | null;
  subdomain: string | null;
  status: string | null;
}

/** `vetra env show` (and mutation result) object — also the `--json` shape. */
export interface EnvDetail {
  id: string;
  name: string | null;
  status: string;
  host: string | null;
  services: {
    type: string;
    prefix: string;
    enabled: boolean;
    size: string | null;
    version: string | null;
  }[];
  packages: { name: string; version: string | null; registry: string }[];
  /** User edits since the last approval; only filled while CHANGES_PENDING. */
  pendingChanges: { type: string; input: unknown; description: string }[];
}

export function toListItems(items: EnvironmentSummary[]): EnvListItem[] {
  return items.map((e) => ({
    id: e.id,
    name: e.name,
    subdomain: e.subdomain,
    status: e.status,
  }));
}

export function toDetail(
  id: string,
  state: VetraCloudEnvironmentGlobalState,
  operations: readonly OperationLike[] = [],
): EnvDetail {
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  return {
    id,
    name: state.label ?? null,
    status: state.status,
    host: state.genericSubdomain ? `${state.genericSubdomain}.${base}` : null,
    services: state.services.map((s) => ({
      type: s.type,
      prefix: s.prefix,
      enabled: s.enabled,
      size: s.selectedRessource ?? null,
      version: s.version ?? null,
    })),
    packages: state.packages.map((p) => ({
      name: p.name,
      version: p.version ?? null,
      registry: p.registry,
    })),
    pendingChanges:
      state.status === "CHANGES_PENDING"
        ? pendingChanges(operations).map((c) => ({
            type: c.type,
            input: c.input,
            description: describePendingChange(c),
          }))
        : [],
  };
}

/** Left-aligned columns, two spaces apart. */
function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  return rows.map((r) =>
    r
      .map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd(),
  );
}

export function formatList(items: EnvListItem[]): string {
  if (items.length === 0) return "No environments.";
  return table([
    ["NAME", "STATUS", "SUBDOMAIN", "ID"],
    ...items.map((e) => [
      e.name ?? "(unnamed)",
      e.status ?? "unknown",
      e.subdomain ?? "-",
      e.id,
    ]),
  ]).join("\n");
}

export function formatDetail(d: EnvDetail): string {
  const lines = [
    `${d.name ?? "(unnamed)"}  [${d.status}]`,
    `id:    ${d.id}`,
    `host:  ${d.host ?? "(none yet)"}`,
  ];
  if (d.services.length === 0) {
    lines.push("services: (none)");
  } else {
    lines.push("services:");
    lines.push(
      ...table([
        ["TYPE", "PREFIX", "ENABLED", "SIZE"],
        ...d.services.map((s) => [
          s.type,
          s.prefix || "-",
          s.enabled ? "yes" : "no",
          s.size ?? "default",
        ]),
      ]).map((l) => `  ${l}`),
    );
  }
  if (d.packages.length === 0) {
    lines.push("packages: (none)");
  } else {
    lines.push("packages:");
    for (const p of d.packages) {
      lines.push(`  ${p.name}${p.version ? `@${p.version}` : ""}`);
    }
  }
  if (d.status === "CHANGES_PENDING") {
    if (d.pendingChanges.length === 0) {
      lines.push("pending changes: (not recorded in the operation log)");
    } else {
      lines.push("pending changes (since last approval):");
      for (const c of d.pendingChanges) lines.push(`  - ${c.description}`);
    }
    lines.push(`Approve with: vetra env approve ${d.id}`);
  }
  return lines.join("\n");
}
