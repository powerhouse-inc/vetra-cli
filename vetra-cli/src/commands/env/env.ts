import { z } from "zod";
import { defineCommand, type Config } from "../../framework.js";
import {
  APPROVABLE_STATUSES,
  canApproveChanges,
  isStudioEnvironment,
  type EnvironmentController,
  type EnvironmentSummary,
  type OperationLike,
  type VetraCloudEnvironmentGlobalState,
} from "@powerhousedao/vetra-cloud-client";
import { listMyEnvironments } from "../../cloud/environments-read.js";
import {
  dispatchEnvironmentActions,
  loadEnvironmentDocument,
} from "../../cloud/environments-write.js";
import { parsePackageSpec } from "../deploy/_helpers.js";
import { resolveEnvRef } from "./resolve.js";
import {
  formatDetail,
  formatList,
  toDetail,
  toListItems,
} from "./format.js";

export const ENV_ACTIONS = [
  "list",
  "show",
  "add-package",
  "remove-package",
  "approve",
] as const;
export type EnvAction = (typeof ENV_ACTIONS)[number];

/** The slice of the environment controller the write actions touch. */
export type EnvActionTarget = Pick<
  EnvironmentController,
  "state" | "addPackage" | "removePackage" | "approveChanges"
>;

/** Cloud access the `env` command needs. The default implementation reuses the
 * deploy commands' Renown session (bearer token for reads, signer for writes);
 * tests inject a fake. */
export interface EnvApi {
  list(): Promise<EnvironmentSummary[]>;
  load(id: string): Promise<{
    state: VetraCloudEnvironmentGlobalState;
    operations: OperationLike[];
  }>;
  dispatch(
    id: string,
    apply: (target: EnvActionTarget) => void,
  ): Promise<VetraCloudEnvironmentGlobalState>;
}

export function createCloudEnvApi(ctx: {
  workdir: string;
  config: Config;
}): EnvApi {
  return {
    list: () => listMyEnvironments(ctx, "MINE"),
    load: (id) => loadEnvironmentDocument(ctx, id),
    dispatch: (id, apply) => dispatchEnvironmentActions(ctx, id, apply),
  };
}

const USAGE: Record<EnvAction, string> = {
  list: "vetra env list",
  show: "vetra env show <env>",
  "add-package": "vetra env add-package <env> <package>[@version]",
  "remove-package": "vetra env remove-package <env> <package>",
  approve: "vetra env approve <env>",
};

function missing(what: string, action: EnvAction): Error {
  return new Error(`Missing ${what}.\nUsage: ${USAGE[action]}`);
}

const DESCRIPTION = `Manage your Vetra Cloud environments (requires Renown authorization — check with whoami).
  vetra env list                                   your environments (id, name, status)
  vetra env show <env>                             status, services, packages, pending changes
  vetra env add-package <env> <package>[@version]  dispatch ADD_PACKAGE (sets CHANGES_PENDING)
  vetra env remove-package <env> <package>         dispatch REMOVE_PACKAGE (sets CHANGES_PENDING)
  vetra env approve <env>                          dispatch APPROVE_CHANGES (deploys pending changes)
<env> is a document id, name, or subdomain. Add --json for machine-readable output.`;

export function createEnvCommand(
  makeApi: (ctx: { workdir: string; config: Config }) => EnvApi = createCloudEnvApi,
) {
  const command = defineCommand({
    id: "env",
    description: DESCRIPTION,
    inputSchema: z.object({
      action: z
        .enum(ENV_ACTIONS)
        .describe(`One of: ${ENV_ACTIONS.join(", ")}.`),
      env: z
        .string()
        .default("")
        .describe("Environment id, name, or subdomain (all actions but list)."),
      package: z
        .string()
        .default("")
        .describe(
          'Package for add-package ("name" or "name@version") and remove-package ("name").',
        ),
      json: z
        .boolean()
        .default(false)
        .describe("Print JSON instead of human-readable text."),
    }),
    execute: async (input, { workdir, config }) => {
      const api = makeApi({ workdir, config });
      const out = (value: unknown, text: string) => ({
        text: input.json ? JSON.stringify(value, null, 2) : text,
      });

      if (input.action === "list") {
        const items = toListItems(await api.list());
        return out(items, formatList(items));
      }

      const ref = input.env.trim();
      if (!ref) throw missing("<env>", input.action);
      const env = resolveEnvRef(await api.list(), ref);

      if (input.action === "show") {
        const { state, operations } = await api.load(env.id);
        const detail = toDetail(env.id, state, operations);
        return out(detail, formatDetail(detail));
      }

      if (input.action === "approve") {
        const state = await api.dispatch(env.id, (target) => {
          const status = target.state.global.status;
          if (!canApproveChanges(status)) {
            throw new Error(
              `Cannot approve "${target.state.global.label ?? env.id}": status is ${status}. ` +
                `Approve only applies from ${APPROVABLE_STATUSES.join(" or ")} — there are no pending changes to deploy.`,
            );
          }
          target.approveChanges({});
        });
        const detail = toDetail(env.id, state);
        return out(
          { action: input.action, ...detail },
          `Approved changes on "${detail.name ?? env.id}" — status ${detail.status}.\n${formatDetail(detail)}`,
        );
      }

      const spec = input.package.trim();
      if (!spec) throw missing("<package>", input.action);
      const pkg = parsePackageSpec(spec);

      if (input.action === "add-package") {
        const state = await api.dispatch(env.id, (target) => {
          const global = target.state.global;
          if (isStudioEnvironment(global.packages.map((p) => p.name))) {
            throw new Error(
              `Cannot add packages to "${global.label ?? env.id}": it runs Vetra Studio and is not a deploy target.`,
            );
          }
          target.addPackage({ packageName: pkg.name, version: pkg.version });
        });
        const detail = toDetail(env.id, state);
        return out(
          { action: input.action, ...detail },
          `Added ${pkg.name}${pkg.version ? `@${pkg.version}` : ""} to "${detail.name ?? env.id}" — status ${detail.status}.\n` +
            `Deploy with: vetra env approve ${env.id}`,
        );
      }

      // remove-package
      if (pkg.version) {
        throw new Error(
          `remove-package takes a package name without a version (got "${spec}").\nUsage: ${USAGE["remove-package"]}`,
        );
      }
      const state = await api.dispatch(env.id, (target) => {
        const global = target.state.global;
        if (!global.packages.some((p) => p.name === pkg.name)) {
          const installed = global.packages.map((p) => p.name);
          throw new Error(
            `Package "${pkg.name}" is not installed on "${global.label ?? env.id}".` +
              (installed.length
                ? `\nInstalled: ${installed.join(", ")}`
                : "\nNo packages are installed."),
          );
        }
        target.removePackage({ packageName: pkg.name });
      });
      const detail = toDetail(env.id, state);
      return out(
        { action: input.action, ...detail },
        `Removed ${pkg.name} from "${detail.name ?? env.id}" — status ${detail.status}.\n` +
          `Deploy with: vetra env approve ${env.id}`,
      );
    },
  });
  // The typed `defineCommand` binding doesn't surface `positional` (the base
  // Command type does), so attach it after: `vetra env <action> [env] [package]`.
  return { ...command, positional: ["action", "env", "package"] as const };
}

export const envCommand = createEnvCommand();
