import type {
  Change,
  ChangeMetrics,
  CheckResult,
  CheckRun,
  GithubLink,
  LaunchLine,
  ProductStep,
  StudioProductState,
  Version,
} from "../gen/schema/types.js";

/**
 * Documents written by earlier builds may lack fields that were added to the
 * state later. Every reducer and every reader passes the state through here
 * first: missing lists become `[]`, missing nullable fields `null` and missing
 * enums their initial value. Fills in place and returns the same object.
 */
export function normalizeProduct(
  state: StudioProductState,
): StudioProductState {
  const s: Partial<StudioProductState> = state;
  s.name ??= null;
  s.idea ??= null;
  s.slug ??= null;
  s.liveUrl ??= null;
  s.appId ??= null;
  s.productionEnvironmentId ??= null;
  s.productDriveId ??= null;
  s.createdAt ??= null;
  s.access ??= "SIGNED_IN";
  s.activeChangeId ??= null;
  s.liveVersion ??= null;
  s.liveSince ??= null;
  s.liveDeploymentId ??= null;
  s.health ??= "UNKNOWN";
  s.pendingRequest ??= null;
  s.launchPermission ??= "UNKNOWN";
  s.suggestions ??= [];
  s.github = normalizeGithub(s.github);
  s.changes ??= [];
  s.changes.forEach(normalizeChange);
  s.versions ??= [];
  s.versions.forEach(normalizeVersion);
  return state;
}

function normalizeGithub(github: GithubLink | undefined): GithubLink {
  if (!github) {
    return {
      status: "NOT_CONNECTED",
      repoFullName: null,
      lastError: null,
      externalChangesSha: null,
    };
  }
  const g: Partial<GithubLink> = github;
  g.status ??= "NOT_CONNECTED";
  g.repoFullName ??= null;
  g.lastError ??= null;
  g.externalChangesSha ??= null;
  return github;
}

function normalizeMetrics(metrics: ChangeMetrics | undefined): ChangeMetrics {
  if (!metrics) {
    return { steps: 0, firstPreviewAt: null, readyAt: null, liveAt: null };
  }
  const m: Partial<ChangeMetrics> = metrics;
  m.steps ??= 0;
  m.firstPreviewAt ??= null;
  m.readyAt ??= null;
  m.liveAt ??= null;
  return metrics;
}

function normalizeChange(change: Change): void {
  const c: Partial<Change> = change;
  c.title ??= null;
  c.chatSessionId ??= null;
  c.chatSessionIds ??= c.chatSessionId ? [c.chatSessionId] : [];
  c.steps ??= [];
  c.steps.forEach(normalizeStep);
  c.milestones ??= [];
  c.checkRuns ??= [];
  c.checkRuns.forEach(normalizeRun);
  c.stuck ??= null;
  c.lintWaivedAt ??= null;
  c.metrics = normalizeMetrics(c.metrics);
}

function normalizeStep(step: ProductStep): void {
  const p: Partial<ProductStep> = step;
  p.done ??= null;
  p.total ??= null;
  p.label ??= null;
  p.reason ??= null;
  p.updatedAt ??= null;
}

function normalizeRun(run: CheckRun): void {
  const r: Partial<CheckRun> = run;
  r.results ??= [];
  r.results.forEach((result: CheckResult) => {
    const x: Partial<CheckResult> = result;
    x.reason ??= null;
  });
}

function normalizeVersion(version: Version): void {
  const v: Partial<Version> = version;
  v.summary ??= null;
  v.changeId ??= null;
  v.packages ??= [];
  v.deploymentId ??= null;
  v.launchedAt ??= null;
  v.lines ??= [];
  v.lines.forEach((line: LaunchLine) => {
    const l: Partial<LaunchLine> = line;
    l.detail ??= null;
  });
  v.changedFiles ??= [];
  v.failure ??= null;
  v.rollbackBlockedReason ??= null;
}
