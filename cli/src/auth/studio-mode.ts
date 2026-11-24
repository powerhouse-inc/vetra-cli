/**
 * Which signature mode a Studio runs in.
 *
 * The mode is the Studio switchboard's create policy (`studioSignatureMode`):
 * the switchboard is the one party that enforces it, so the Cli writes spec
 * documents the way the switchboard creates documents. Every Studio signs as
 * its agent's session (`studio-identity.ts`). A **cloud Studio** (an
 * environment id is set) belongs on a `v2-required` switchboard: its agent
 * writes no legacy document.
 */
export type StudioSignatureMode = "legacy" | "v2-required";

/** The environment id config or env names, trimmed. */
export function environmentIdOf(
  config: { environmentId?: unknown } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromConfig =
    typeof config?.environmentId === "string" ? config.environmentId.trim() : "";
  return fromConfig || env.VETRA_ENVIRONMENT_ID?.trim() || undefined;
}

/**
 * Whether this is a cloud Studio: an environment id is set. The owner gate
 * and the agent's identity use this one test, so they can never disagree.
 */
export function isCloudStudio(
  config: { environmentId?: unknown } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(environmentIdOf(config, env));
}

interface CreatePolicyClient {
  getCreateSignaturePolicy(): Promise<StudioSignatureMode>;
}

const modes = new WeakMap<object, Promise<StudioSignatureMode>>();

/**
 * The create policy of the switchboard the reactor is attached to, read once
 * per client (a failed read is retried on the next call). The first read logs
 * one error when a cloud Studio runs on a `legacy` switchboard. The Studio
 * still starts.
 */
export function studioSignatureMode(
  reactor: { client: unknown },
  config: { environmentId?: unknown } | undefined,
  log?: { error?: (msg: string) => void },
  env: NodeJS.ProcessEnv = process.env,
): Promise<StudioSignatureMode> {
  const client = reactor.client as CreatePolicyClient;
  const known = modes.get(client);
  if (known) return known;
  const mode = client.getCreateSignaturePolicy().then((policy) => {
    const cloud = isCloudStudio(config, env);
    if (cloud && policy === "legacy") {
      log?.error?.(
        "[signing] this cloud Studio's switchboard creates legacy documents: the agent signs, but writes no legacy document. Run it on a switchboard with createSignaturePolicy v2-required.",
      );
    }
    return policy;
  });
  modes.set(client, mode);
  mode.catch(() => modes.delete(client));
  return mode;
}
