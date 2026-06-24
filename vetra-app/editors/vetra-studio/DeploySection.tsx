import { useRenown } from "@powerhousedao/reactor-browser";
import { Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeployTarget } from "./hooks/useSessionDeployTarget.js";
import { resolveDeployProject } from "./deploy/resolveDeployProject.js";
import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { useCloudAuth } from "./deploy/cloudAuth.js";
import { getAuthToken, setAuthTokenProvider } from "./deploy/cloudClient.js";
import { resolveCloudDriveId } from "./deploy/config.js";
import { ProjectDeployDetail } from "./deploy/ProjectDeployDetail.js";
import {
  ProjectDeployList,
  type ProjectDeployment,
} from "./deploy/ProjectDeployList.js";
import {
  deriveEnvDeployments,
  type DeployData,
  type PackageView,
} from "./deploy/projectDeployments.js";
import {
  useCloudEnvironments,
  type EnvironmentsState,
} from "./deploy/useCloudEnvironments.js";
import {
  useInstalledPackages,
  type InstalledPackagesState,
} from "./deploy/useInstalledPackages.js";
import {
  useProjectPackages,
  type ProjectPackagesState,
} from "./deploy/useProjectPackages.js";
import {
  useReleaseStatuses,
  type ReleaseStatus,
} from "./deploy/useReleaseStatuses.js";
import { useProjects } from "./specify/useProjects.js";
import type { Project } from "./specify/projects.js";

const UNKNOWN_RELEASE: ReleaseStatus = { known: false };

type View = { kind: "list" } | { kind: "deploy"; project: Project };

/** Adapt the batched package lookup to a single project's resolved package. */
function toPackageView(pkgs: ProjectPackagesState, name: string): PackageView {
  if (pkgs.status === "loading") return { status: "loading" };
  if (pkgs.status === "error")
    return { status: "error", message: pkgs.message };
  const info = pkgs.byProject.get(name);
  return info
    ? { status: "ready", name: info.name, version: info.version }
    : { status: "error", message: "No package.json found for this project." };
}

/** Resolve the deploy detail's data for one project, gated on sign-in and every
 * source loading, so the variants render fully-formed. */
function buildDeployData(args: {
  authorized: boolean;
  authLoading: boolean;
  envs: EnvironmentsState;
  installed: InstalledPackagesState;
  release: ReleaseStatus;
  pkg: PackageView;
}): DeployData {
  const { authorized, authLoading, envs, installed, release, pkg } = args;
  if (!authorized) return { kind: "unauthenticated" };
  if (authLoading) return { kind: "loading" };
  if (envs.status === "loading") return { kind: "loading" };
  if (envs.status === "error") return { kind: "error", message: envs.error };
  if (installed.status === "idle" || installed.status === "loading")
    return { kind: "loading" };
  if (installed.status === "error")
    return { kind: "error", message: installed.message };
  if (pkg.status === "loading") return { kind: "loading" };
  if (pkg.status === "error") return { kind: "error", message: pkg.message };
  return {
    kind: "ready",
    environments: deriveEnvDeployments({
      environments: envs.items,
      byEnv: installed.byEnv,
      packageName: pkg.name,
      release,
    }),
  };
}

/** Home > Deploy. Requires a Renown sign-in, then lists the drive's projects
 * with their deploy status (which of the user's environments has each project's
 * package installed) and lets the user deploy one. The list waits for envs +
 * package data so cards render fully resolved. */
export function DeploySection({
  productName,
  onExitToHome,
  focus,
}: {
  productName: string;
  onExitToHome: () => void;
  /** Auto-nav target: the project the agent is deploying. Applied once per
   * deploy (keyed by callId); null when nothing is being followed. */
  focus?: DeployTarget | null;
}) {
  const renown = useRenown();
  const auth = useCloudAuth();
  const driveId = resolveCloudDriveId(auth.address);
  const { state: envs, refresh } = useCloudEnvironments(
    auth.authorized,
    auth.address,
  );
  const [view, setView] = useState<View>({ kind: "list" });
  // Bumped after a successful deploy to re-resolve package/release/install data.
  const [reloadNonce, setReloadNonce] = useState(0);
  // project name -> version we just deployed; trusted over the (briefly stale)
  // registry until the registry catches up to it.
  const [deployedVersions, setDeployedVersions] = useState<Map<string, string>>(
    new Map(),
  );

  const projects = useProjects();
  const projectNames = projects.map((p) => p.name);
  const pkgs = useProjectPackages(projectNames, reloadNonce);
  const releases = useReleaseStatuses(projectNames, reloadNonce);
  const envSummaries =
    envs.status === "ready"
      ? envs.items.map((e) => ({ id: e.id, name: e.name }))
      : [];
  const installed = useInstalledPackages(
    envSummaries,
    driveId,
    auth.signer,
    reloadNonce,
  );

  // Attach the no-aud Renown token to every cloud client request.
  useEffect(() => {
    setAuthTokenProvider(() => getAuthToken(renown));
    return () => setAuthTokenProvider(null);
  }, [renown]);

  // Auto-nav focus: open the deploy detail for the project the agent is
  // deploying. Applied once per focus (keyed by callId) so navigating within
  // Deploy isn't overridden until the next deploy; retried across renders
  // while projects/packages are still resolving, then given up if the target
  // never matches (e.g. an external package) so we neither loop nor strand.
  const appliedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focus.callId === appliedFocusRef.current) return;
    const project = resolveDeployProject(
      focus,
      projects,
      pkgs.status === "ready" ? pkgs.byProject : undefined,
    );
    if (project) {
      setView({ kind: "deploy", project });
      appliedFocusRef.current = focus.callId;
      return;
    }
    const settled =
      (focus.project ? projects.length > 0 : true) &&
      (focus.packageName ? pkgs.status !== "loading" : true);
    if (settled) appliedFocusRef.current = focus.callId;
  }, [focus, projects, pkgs]);

  const atRoot = view.kind === "list";
  const goToList = () => setView({ kind: "list" });
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Deploy", onClick: atRoot ? undefined : goToList },
    ...(view.kind === "deploy" ? [{ label: view.project.name }] : []),
  ];

  const listError =
    envs.status === "error"
      ? envs.error
      : installed.status === "error"
        ? installed.message
        : pkgs.status === "error"
          ? pkgs.message
          : null;
  const listLoading =
    envs.status === "loading" ||
    pkgs.status === "loading" ||
    releases.status === "loading" ||
    installed.status === "loading" ||
    installed.status === "idle";

  const releaseFor = (name: string): ReleaseStatus =>
    releases.status === "ready"
      ? (releases.byProject.get(name) ?? UNKNOWN_RELEASE)
      : UNKNOWN_RELEASE;

  // After a deploy the registry packument is stale for a while, so it still
  // reports "needs release". Trust the version we just published until the
  // registry's latest catches up to it, then defer to the live status again.
  const effectiveReleaseFor = (name: string): ReleaseStatus => {
    const live = releaseFor(name);
    const deployed = deployedVersions.get(name);
    if (deployed && !(live.known && live.publishedVersion === deployed)) {
      return {
        known: true,
        upToDate: true,
        needsRelease: false,
        localVersion: deployed,
        publishedVersion: deployed,
      };
    }
    return live;
  };

  const deployments: ProjectDeployment[] = projects.map((project) => {
    const info =
      pkgs.status === "ready" ? pkgs.byProject.get(project.name) : null;
    const pkgName = info?.name;
    const where =
      pkgName && installed.status === "ready"
        ? (installed.byPackage.get(pkgName) ?? [])
        : [];
    return {
      project,
      deployedEnvironments: where,
      release: effectiveReleaseFor(project.name),
    };
  });

  const selectedProject = view.kind === "deploy" ? view.project : null;
  const selectedPkg: PackageView = selectedProject
    ? toPackageView(pkgs, selectedProject.name)
    : { status: "loading" };
  const selectedRelease = selectedProject
    ? effectiveReleaseFor(selectedProject.name)
    : UNKNOWN_RELEASE;
  const selectedDeploy: DeployData = buildDeployData({
    authorized: auth.authorized,
    authLoading: auth.loading,
    envs,
    installed,
    release: selectedRelease,
    pkg: selectedPkg,
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {!auth.authorized ? (
        <AuthGate loading={auth.loading} onLogin={auth.login} />
      ) : view.kind === "deploy" ? (
        <ProjectDeployDetail
          project={view.project}
          pkg={selectedPkg}
          release={selectedRelease}
          deploy={selectedDeploy}
          driveId={driveId}
          signer={auth.signer}
          onSignIn={auth.login}
          onRefresh={refresh}
          onDeployed={(version) => {
            setDeployedVersions((prev) =>
              new Map(prev).set(view.project.name, version),
            );
            setReloadNonce((n) => n + 1);
            refresh();
          }}
        />
      ) : listError ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-vetra-border bg-vetra-card px-4 py-6">
          <p className="text-sm text-vetra-destructive">{listError}</p>
          <button
            type="button"
            onClick={refresh}
            className="text-sm text-vetra-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : listLoading ? (
        <ProjectsLoading />
      ) : (
        <ProjectDeployList
          deployments={deployments}
          onDeploy={(project) => setView({ kind: "deploy", project })}
        />
      )}
    </div>
  );
}

function ProjectsLoading() {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-vetra-fg">Projects</h3>
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex animate-pulse flex-col gap-4 rounded-xl border border-vetra-border bg-vetra-card p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-32 rounded bg-vetra-muted" />
              <div className="h-3 w-20 rounded bg-vetra-muted" />
            </div>
            <div className="h-3 w-24 rounded bg-vetra-muted" />
            <div className="h-9 w-full rounded-lg bg-vetra-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}

function AuthGate({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-vetra-border bg-vetra-card px-6 py-24 text-center">
      <Rocket size={28} className="text-vetra-primary" />
      <h2 className="text-lg font-semibold text-vetra-fg">
        Deploy to vetra.io
      </h2>
      {loading ? (
        <p className="text-sm text-vetra-muted-fg">Checking sign-in…</p>
      ) : (
        <>
          <p className="max-w-md text-sm text-vetra-muted-fg">
            Sign in with Renown to see your projects and deploy them to the
            cloud.
          </p>
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
          >
            Connect with Renown
          </button>
        </>
      )}
    </div>
  );
}
