import { ArrowRight, Folder, Server } from "lucide-react";
import type { Project } from "../specify/projects.js";
import type { ReleaseStatus } from "./useReleaseStatuses.js";

/** A project with its resolved deploy status: the environments (by label) where
 * its package is installed (empty = not deployed), plus whether its current
 * source is already published or needs a new release. */
export type ProjectDeployment = {
  project: Project;
  deployedEnvironments: string[];
  release: ReleaseStatus;
};

/** Home > Deploy. Lists the drive's projects with a Deploy action and, for each,
 * whether its package is installed in any of the user's environments (and
 * where). Fully resolved before render — no per-card loading. UI only: the
 * Deploy flow doesn't push anything yet. */
export function ProjectDeployList({
  deployments,
  onDeploy,
}: {
  deployments: ProjectDeployment[];
  onDeploy: (project: Project) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">Projects</h3>

      {deployments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-accent px-4 py-6 text-sm text-muted-foreground">
          No projects yet. Create specification documents in the Specify
          section, then deploy them here.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
          {deployments.map(({ project, deployedEnvironments, release }) => (
            <ProjectCard
              key={project.id}
              project={project}
              deployedEnvironments={deployedEnvironments}
              release={release}
              onDeploy={() => onDeploy(project)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  deployedEnvironments,
  release,
  onDeploy,
}: {
  project: Project;
  deployedEnvironments: string[];
  release: ReleaseStatus;
  onDeploy: () => void;
}) {
  const deployed = deployedEnvironments.length > 0;
  const count = project.documents.length;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Folder size={16} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-base font-semibold text-foreground">
            {project.name}
          </span>
        </span>
        <StatusPill deployed={deployed} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {count} {count === 1 ? "document" : "documents"}
        </span>
        {deployed ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server size={13} className="shrink-0" />
            <span className="truncate">{deployedEnvironments.join(", ")}</span>
          </span>
        ) : null}
        <ReleaseLine release={release} />
      </div>

      <button
        type="button"
        onClick={onDeploy}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
      >
        {deployed ? "Manage deployment" : "Set up deploy"}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

/** "Up to date" / "Needs release" — orthogonal to deployed status: deployed =
 * installed in an env; this = current source already published. Omitted when
 * undeterminable. */
function ReleaseLine({ release }: { release: ReleaseStatus }) {
  if (!release.known) return null;
  if (release.needsRelease) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <span className="inline-block h-2 w-2 rounded-full bg-warning" />
        Needs release
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full bg-success" />
      Up to date
    </span>
  );
}

function StatusPill({ deployed }: { deployed: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          deployed ? "bg-success" : "bg-muted-foreground"
        }`}
      />
      {deployed ? "Deployed" : "Not deployed"}
    </span>
  );
}
