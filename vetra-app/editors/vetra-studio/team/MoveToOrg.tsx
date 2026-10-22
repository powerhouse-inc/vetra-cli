/**
 * "Move into an organisation" (P6 task 1.12, cloud side Task 1.3): a personal
 * Studio's Owner picks an organisation they own and hands the Studio (and its
 * remaining budget) to it; members of the org then get access by their role.
 *
 * The organisation list is Renown's `organizationsByMember` — only the ones
 * the person is an OWNER of can take a Studio. The move is the cloud's
 * `moveStudioToOrg` mutation (Task 1.3). Both are injectable so the panel is
 * testable without the services; the defaults talk to the configured
 * endpoints.
 */
import { useEffect, useState } from "react";
import {
  getAuthToken,
  resolveCloudGraphqlEndpoint,
} from "../deploy/cloudClient.js";
import { useT } from "../i18n/useT.js";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import {
  resolveStudioEnvironmentId,
  resolveStudioRenownOrgsUrl,
} from "../hooks/preview-server-client.js";
import { canManageTeam } from "./roleGate.js";
import { useTeam, type Team } from "./useTeam.js";

export interface OrgOption {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER";
}

/** Only the orgs where the person is an Owner: the cloud requires it. */
export function ownerOrgs(orgs: readonly OrgOption[]): OrgOption[] {
  return orgs.filter((org) => org.role === "OWNER");
}

/** Renown: the orgs `address` belongs to (role included). */
export const ORGS_QUERY = `query OrgMemberships($address: String!) {
  organizationsByMember(address: $address) { id name role }
}`;

/** Cloud switchboard (Task 1.3): hand a personal Studio to an organisation. */
export const MOVE_MUTATION = `mutation MoveStudioToOrg($environmentId: String!, $orgId: String!) {
  VetraStudioPool { moveStudioToOrg(environmentId: $environmentId, orgId: $orgId) { ownerOrgId } }
}`;

/** Connect's Renown session (the same boundary `deploy/cloudClient.ts` uses). */
type ConnectRenown = {
  getBearerToken(opts: { expiresIn: number }): Promise<string | null>;
};
const globals = globalThis as { ph?: { renown?: ConnectRenown } };

export interface MoveToOrgDeps {
  /** The orgs the signed-in person belongs to (all roles). */
  loadOrgs(address: string, signal?: AbortSignal): Promise<OrgOption[]>;
  /** The cloud move; resolves with the org the Studio now belongs to. */
  move(orgId: string): Promise<{ ownerOrgId: string }>;
}

async function gql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  token: string | null,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: { message?: string }[];
  } | null;
  if (!res.ok || !body?.data || body.errors?.length) {
    throw new Error(body?.errors?.[0]?.message ?? `GraphQL ${res.status}`);
  }
  return body.data;
}

/** The ambient deps: Renown orgs + the cloud switchboard. */
export function defaultMoveDeps(environmentId: string): MoveToOrgDeps {
  return {
    async loadOrgs(address, signal) {
      const endpoint = await resolveStudioRenownOrgsUrl();
      if (!endpoint) throw new Error("no orgs endpoint configured");
      const token = await getAuthToken(globals.ph?.renown);
      const data = await gql<{ organizationsByMember?: OrgOption[] }>(
        endpoint,
        ORGS_QUERY,
        { address },
        token,
        signal,
      );
      return data.organizationsByMember ?? [];
    },
    async move(orgId) {
      const endpoint = await resolveCloudGraphqlEndpoint();
      const token = await getAuthToken(globals.ph?.renown);
      const data = await gql<{
        VetraStudioPool?: {
          moveStudioToOrg?: { ownerOrgId?: string } | null;
        } | null;
      }>(endpoint, MOVE_MUTATION, { environmentId, orgId }, token);
      const ownerOrgId = data.VetraStudioPool?.moveStudioToOrg?.ownerOrgId;
      if (!ownerOrgId) throw new Error("the Studio was not moved");
      return { ownerOrgId };
    },
  };
}

type Load =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "loaded"; orgs: OrgOption[] };

export function MoveToOrg({
  team,
  deps,
}: { team?: Team; deps?: MoveToOrgDeps } = {}) {
  // The page already polls the team; standalone use (tests, other hosts)
  // polls its own.
  if (team) return <MoveToOrgView team={team} deps={deps} />;
  return <MoveToOrgPolling deps={deps} />;
}

function MoveToOrgPolling({ deps }: { deps?: MoveToOrgDeps }) {
  const team = useTeam();
  return <MoveToOrgView team={team} deps={deps} />;
}

function MoveToOrgView({ team, deps }: { team: Team; deps?: MoveToOrgDeps }) {
  const { t } = useT();
  const signIn = useStudioSignIn();
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [chosen, setChosen] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<"done" | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    void resolveStudioEnvironmentId().then((id) => {
      if (live) setEnvironmentId(id);
    });
    return () => {
      live = false;
    };
  }, []);

  const address = signIn.address;
  const personalOwner =
    !team.loading &&
    !team.unavailable &&
    team.orgId === null &&
    canManageTeam(team.me) &&
    team.me !== null;
  const enabled = personalOwner && environmentId !== null;

  useEffect(() => {
    if (!enabled || !address) return;
    const controller = new AbortController();
    const depsFor = deps ?? defaultMoveDeps(environmentId);
    depsFor
      .loadOrgs(address, controller.signal)
      .then((orgs) => {
        if (controller.signal.aborted) return;
        const owned = ownerOrgs(orgs);
        setLoad(
          owned.length ? { kind: "loaded", orgs: owned } : { kind: "empty" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, [enabled, address, deps, environmentId]);

  if (team.loading) return null;
  if (!enabled) return null;

  const chosenOrg =
    load.kind === "loaded" ? load.orgs.find((o) => o.id === chosen) : undefined;

  async function move(): Promise<void> {
    if (!chosenOrg || !environmentId) return;
    setMoving(true);
    setResult(null);
    try {
      await (deps ?? defaultMoveDeps(environmentId)).move(chosenOrg.id);
      setResult("done");
    } catch {
      setResult("failed");
    } finally {
      setMoving(false);
    }
  }

  return (
    <section
      aria-label={t("team.move.heading")}
      className="flex flex-col gap-1.5"
    >
      <h3 className="font-medium text-foreground">{t("team.move.heading")}</h3>
      {load.kind === "unavailable" ? (
        <p role="status" className="text-muted-foreground">
          {t("team.move.unavailable")}
        </p>
      ) : load.kind === "empty" ? (
        <p className="text-muted-foreground">{t("team.move.noOrgs")}</p>
      ) : load.kind === "loading" ? (
        <p className="text-muted-foreground">…</p>
      ) : (
        <>
          <label
            htmlFor="move-to-org"
            className="text-xs text-muted-foreground"
          >
            {t("team.move.choose")}
          </label>
          <select
            id="move-to-org"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("team.move.choose")}</option>
            {load.orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          {chosenOrg ? (
            <p className="text-xs text-muted-foreground">
              {t("team.move.explainer", { org: chosenOrg.name })}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!chosenOrg || moving || result === "done"}
              onClick={() => void move()}
              className="rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-medium text-vetra-primary-fg hover:opacity-90 disabled:opacity-50"
            >
              {t("team.move.button", { org: chosenOrg?.name ?? "" })}
            </button>
            {result === "done" ? (
              <span role="status" className="text-xs text-muted-foreground">
                {t("team.move.done", { org: chosenOrg?.name ?? "" })}
              </span>
            ) : result === "failed" ? (
              <span role="alert" className="text-xs text-destructive">
                {t("team.move.failed")}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
