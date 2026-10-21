/**
 * Preview-server trigger — long-running HTTP endpoint for the vetra-studio
 * BUILD pane.
 *
 * Triggers are the framework's contract for side-effecty work that needs
 * full runtime access (services + event bus). We use one here because:
 *   - `/resolve` and `/start` need `services.list()` and `services.start()`,
 *     which only the framework-issued `ServiceManager` provides.
 *   - `/events` (SSE) needs to bridge the framework's event bus to browser
 *     EventSource clients, which `ctx.context.on` exposes.
 *
 * `setup()` boots the http server and captures the runtime handles in
 * closures shared with the http handlers. `poll()` returns null forever —
 * this trigger never emits work items; it exists purely for its setup-
 * lifetime side effects. `teardown()` closes the server on daemon shutdown.
 */
import fs from "node:fs";
import path from "node:path";
import { defineTrigger } from "../framework.js";
import {
  DEFAULT_PREVIEW_SERVER_PORT,
  startPreviewServer,
  type PreviewServerHandle,
} from "../preview-server/index.js";
import { setRequireAdminIdentity } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { resolveStudioRenownUrl } from "../lifecycle/connect-drive-url.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { createMemberAuthorizer } from "../preview-server/request-auth.js";
import { createTeamRoutes } from "../preview-server/team-routes.js";
import { createMembership, type Membership } from "../team/membership.js";
import { fetchOrgMembership } from "../team/renown-orgs.js";
import { createDelegationCheck } from "../team/delegation-check.js";
import { createAcceptedTeam } from "../team/team-state.js";
import { isOrgStudio, readTeamDocument, type TeamContext } from "../team/team-doc.js";
import type { Member } from "../team/roles.js";
import { createTrustLedger, verifySignedOperation } from "../team/trust.js";
import { DEFAULT_PH_VERSION } from "../ph-version.gen.js";
import { VETRA_CLI_VERSION } from "../version-banner.js";

interface TriggerState {
  handle: PreviewServerHandle | undefined;
}

export const previewServerTrigger = defineTrigger<TriggerState>({
  id: "preview-server",
  type: "condition",
  state: () => ({ handle: undefined }),

  async setup(ctx) {
    const services = ctx.commandContext.services;
    const on = ctx.commandContext.on;
    const workdir = ctx.context.workdir;
    if (!services) {
      ctx.context.log?.warn?.(
        "[preview-server] no ServiceManager in context — skipping start",
      );
      return;
    }
    if (!on) {
      ctx.context.log?.warn?.(
        "[preview-server] no event-bus accessor in context — skipping start",
      );
      return;
    }

    const config = ctx.context.config;
    const { renownUrl } = resolveCloudConfig(config);
    const cloud = Boolean(config.environmentId?.trim());
    // Cloud Studio: the agent's Renown identity must be an ADMINS wallet.
    setRequireAdminIdentity(cloud);

    // Verify bearers and delegations on the Renown the Studio's Connect logs in on.
    const gateRenownUrl = resolveStudioRenownUrl(process.env.RENOWN_URL, config.cloudRenownUrl, {
      warn: (m) => ctx.context.log?.warn?.(m),
    });
    const orgId = config.studioOrgId?.trim() || null;
    const orgsUrl = config.renownOrgsUrl;
    // The reactor context the team document lives in (TeamContext's drive hooks).
    const teamCtx = { ...ctx.commandContext, workdir, config } as TeamContext;
    const delegationCheck = createDelegationCheck({ renownUrl: gateRenownUrl });

    // Late-bound: the acceptance source and the ledger both ask the membership
    // that is built from them (they only run after construction).
    const team: { membership?: Membership } = {};
    const ledger = createTrustLedger(workdir, {
      resolveMember: (address) => {
        if (!team.membership) throw new Error("membership is not ready");
        return team.membership.resolveBase(address);
      },
      checkDelegation: delegationCheck,
      now: Date.now,
      // The one unsigned INIT_TEAM exception: local (legacy) Studios only.
      allowUnsignedInit: !cloud && !isOrgStudio(config),
    });
    const acceptedTeam = createAcceptedTeam({
      orgId,
      ledger,
      readDocument: () => readTeamDocument(teamCtx),
      onAcceptedChange: () => team.membership?.invalidate(),
    });
    const membership = createMembership({
      orgId,
      admins: process.env.ADMINS ?? "",
      fetchOrgMembership: (id, address) => {
        if (!orgsUrl) return Promise.reject(new Error("VETRA_RENOWN_ORGS_URL is not configured"));
        return fetchOrgMembership(orgsUrl, id, address);
      },
      acceptedTeam,
      // C17: no Studio product App DID is known yet; null admits every PUBLISHER.
      appDid: async () => null,
      now: Date.now,
    });
    team.membership = membership;

    const teamRoutes = createTeamRoutes({
      orgId,
      members: async () => {
        const state = await acceptedTeam();
        const out: Member[] = [];
        for (const reviewer of state.reviewers) {
          const base = await membership.resolveBase(reviewer.address);
          if (base) {
            out.push({
              address: reviewer.address,
              name: reviewer.name ?? base.name,
              role: base.role,
              reviewer: true,
            });
          }
        }
        return out;
      },
      // P6-4 stores one delegation per member; task 1.11 writes these files.
      hasDelegation: async (address) =>
        fs.existsSync(
          path.join(workdir, ".ph", "vetra", "team", "delegations", `${address.toLowerCase()}.json`),
        ),
      verifyAction: (action, documentId) => {
        const op = {
          id: action.id,
          index: 0,
          hash: "",
          timestampUtcMs: action.timestampUtcMs,
          action,
        };
        return verifySignedOperation(op, { documentId, branch: "main" }, delegationCheck);
      },
      relay: async (documentId, actions) => {
        const drive = await getEmbeddedDrive(ctx.commandContext);
        if (!drive) throw new Error("reactor unavailable");
        await drive.reactor.client.execute(documentId, "main", actions);
      },
    });

    const authorizeMember = createMemberAuthorizer({
      renownUrl: gateRenownUrl,
      cloud,
      audience: () => ctx.commandContext.proxy?.url,
      membership,
    });

    try {
      ctx.state.handle = await startPreviewServer({
        services,
        subscribe: (event, handler) => on(event, handler),
        workdir,
        renownUrl,
        registryUrl: ctx.context.config.registryUrl,
        port: DEFAULT_PREVIEW_SERVER_PORT,
        proxyPublicUrl: ctx.commandContext.proxy?.url,
        versions: { vetraCli: VETRA_CLI_VERSION, ph: DEFAULT_PH_VERSION },
        getReactor: () => getEmbeddedDrive(ctx.commandContext),
        agentLogging: config.agentLogging,
        cloud,
        // Verify owner/member bearers on the Renown the Studio's Connect logs in on.
        gateRenownUrl,
        // Read per request: the proxy's public URL can land after startup.
        getProxyPublicUrl: () => ctx.commandContext.proxy?.url,
        authorizeMember,
        teamRoutes,
        log: {
          info: (m) => ctx.context.log?.info?.(m),
          error: (m) => ctx.context.log?.error?.(m),
          debug: (m) => ctx.context.log?.debug?.(m),
        },
      });
    } catch (err) {
      ctx.context.log?.error?.(
        `[preview-server] failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  async teardown(ctx) {
    await ctx.state.handle?.stop();
    ctx.state.handle = undefined;
  },

  async poll() {
    return null;
  },
});
