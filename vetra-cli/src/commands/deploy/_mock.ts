/**
 * MOCK backend for the deploy-environment commands.
 *
 * Cloud authentication isn't wired up yet, so these functions stand in for the
 * real Vetra Cloud API (switchboard.staging.vetra.io + the
 * `vetra-cloud-environment` document model that vetra-app's Studio Deploy
 * section talks to). The shapes mirror that model, so swapping in the real
 * client later is contained to this file.
 *
 * Mutations live in a module-level store, so they persist for the life of the
 * process: inside the long-running daemon a create → list/get/update sequence
 * stays consistent within a session. One-shot CLI invocations see only the
 * seeds (a fresh process each time) — expected for a placeholder.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const cloudServiceTypeSchema = z.enum([
  "CONNECT",
  "SWITCHBOARD",
  "FUSION",
]);
export type CloudServiceType = z.infer<typeof cloudServiceTypeSchema>;

export const environmentStatusSchema = z.enum([
  "DRAFT",
  "CHANGES_PENDING",
  "CHANGES_APPROVED",
  "CHANGES_PUSHED",
  "DEPLOYING",
  "DEPLOYMENT_FAILED",
  "READY",
  "TERMINATING",
  "DESTROYED",
  "ARCHIVED",
  "STOPPED",
]);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

/** Services the user can toggle on an environment (matches the Studio's
 * MANAGEABLE_SERVICES — CLINT is excluded; it needs more than a toggle). */
export const MANAGEABLE_SERVICES = cloudServiceTypeSchema.options;

export interface EnvironmentService {
  type: CloudServiceType;
  prefix: string;
  enabled: boolean;
}

export interface EnvironmentPackage {
  name: string;
  version?: string;
}

export interface Environment {
  id: string;
  label: string;
  status: EnvironmentStatus;
  owner: string | null;
  subdomain: string;
  baseDomain: string;
  defaultPackageRegistry: string;
  services: EnvironmentService[];
  packages: EnvironmentPackage[];
  customDomain: string | null;
}

export type ListScope = "MINE" | "ALL";

const BASE_DOMAIN = "vetra.io";
const DEFAULT_PACKAGE_REGISTRY = "https://registry.dev.vetra.io";
const MOCK_OWNER = "did:mock:vetra-cli-user";

const SERVICE_PREFIX: Record<CloudServiceType, string> = {
  CONNECT: "connect",
  SWITCHBOARD: "switchboard",
  FUSION: "fusion",
};

/** Accepts a comma-separated string (CLI) or a real array (agent/MCP). */
export const serviceListSchema = z.preprocess((v) => {
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());
  if (Array.isArray(v))
    return (v as unknown[]).map((s) =>
      typeof s === "string" ? s.toUpperCase() : s,
    );
  return v;
}, z.array(cloudServiceTypeSchema));

/** Accepts a comma-separated string (CLI) or a real array (agent/MCP). */
export const packageListSchema = z.preprocess((v) => {
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return v;
}, z.array(z.string()));

/** Parse a `name@version` spec into a package. Scope-aware: `@acme/todo@1.2.0`
 * splits on the last `@`, `@acme/todo` (no version) keeps the whole name. */
export function parsePackageSpec(spec: string): EnvironmentPackage {
  const at = spec.lastIndexOf("@");
  if (at > 0) {
    const version = spec.slice(at + 1);
    return { name: spec.slice(0, at), version: version || undefined };
  }
  return { name: spec };
}

export function environmentHost(env: Environment): string {
  return `${env.subdomain}.${env.baseDomain}`;
}

export function serviceHost(env: Environment, svc: EnvironmentService): string {
  return `${svc.prefix}.${env.subdomain}.${env.baseDomain}`;
}

function makeServices(enabled: readonly CloudServiceType[]): EnvironmentService[] {
  return MANAGEABLE_SERVICES.map((type) => ({
    type,
    prefix: SERVICE_PREFIX[type],
    enabled: enabled.includes(type),
  }));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A `<slug>-<short-hex>` subdomain, standing in for the Studio's
 * adjective-animal-shortId generator. */
function generateSubdomain(label: string): string {
  const slug = slugify(label) || "env";
  const short = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slug}-${short}`;
}

function seed(): Map<string, Environment> {
  const envs: Environment[] = [
    {
      id: "env-mock-0001",
      label: "Acme Production",
      status: "READY",
      owner: MOCK_OWNER,
      subdomain: "acme-prod-1a2b3c4d",
      baseDomain: BASE_DOMAIN,
      defaultPackageRegistry: DEFAULT_PACKAGE_REGISTRY,
      services: makeServices(["CONNECT", "SWITCHBOARD"]),
      packages: [{ name: "@acme/todo", version: "1.2.0" }],
      customDomain: "app.acme.example",
    },
    {
      id: "env-mock-0002",
      label: "Staging",
      status: "DEPLOYING",
      owner: MOCK_OWNER,
      subdomain: "staging-9f8e7d6c",
      baseDomain: BASE_DOMAIN,
      defaultPackageRegistry: DEFAULT_PACKAGE_REGISTRY,
      services: makeServices(["CONNECT"]),
      packages: [],
      customDomain: null,
    },
  ];
  return new Map(envs.map((e) => [e.id, e]));
}

const store = seed();

export function listEnvironments(
  opts: { scope?: ListScope; status?: string } = {},
): Environment[] {
  let items = [...store.values()];
  // scope MINE/ALL is a no-op in the mock (single owner) — kept for parity
  // with the real `myEnvironments(scope)` query.
  if (opts.status) {
    const want = opts.status.toUpperCase();
    items = items.filter((e) => e.status === want);
  }
  return items;
}

/** Resolve by id, name, or subdomain. Returns the live store object so callers
 * that mutate (update) write through. */
export function findEnvironment(query: string): Environment | undefined {
  const q = query.trim();
  const direct = store.get(q);
  if (direct) return direct;
  const lower = q.toLowerCase();
  return [...store.values()].find(
    (e) => e.subdomain === q || e.label === q || e.label.toLowerCase() === lower,
  );
}

export interface CreateEnvironmentInput {
  label: string;
  services?: CloudServiceType[];
}

export function createEnvironment(input: CreateEnvironmentInput): Environment {
  const enabled: CloudServiceType[] =
    input.services && input.services.length > 0 ? input.services : ["CONNECT"];
  const env: Environment = {
    id: randomUUID(),
    label: input.label,
    status: "DRAFT",
    owner: MOCK_OWNER,
    subdomain: generateSubdomain(input.label),
    baseDomain: BASE_DOMAIN,
    defaultPackageRegistry: DEFAULT_PACKAGE_REGISTRY,
    services: makeServices(enabled),
    packages: [],
    customDomain: null,
  };
  store.set(env.id, env);
  return env;
}

export interface UpdateEnvironmentInput {
  label?: string;
  status?: EnvironmentStatus;
  enableServices?: CloudServiceType[];
  disableServices?: CloudServiceType[];
  addPackages?: EnvironmentPackage[];
  removePackages?: string[];
}

export function updateEnvironment(
  env: Environment,
  changes: UpdateEnvironmentInput,
): Environment {
  if (changes.label !== undefined) env.label = changes.label;
  if (changes.status !== undefined) env.status = changes.status;
  for (const type of changes.enableServices ?? []) {
    const svc = env.services.find((s) => s.type === type);
    if (svc) svc.enabled = true;
  }
  for (const type of changes.disableServices ?? []) {
    const svc = env.services.find((s) => s.type === type);
    if (svc) svc.enabled = false;
  }
  for (const pkg of changes.addPackages ?? []) {
    const existing = env.packages.find((p) => p.name === pkg.name);
    if (existing) existing.version = pkg.version;
    else env.packages.push(pkg);
  }
  if (changes.removePackages && changes.removePackages.length > 0) {
    const remove = new Set(changes.removePackages);
    env.packages = env.packages.filter((p) => !remove.has(p.name));
  }
  store.set(env.id, env);
  return env;
}
