import type {
  Change,
  ChangeCost,
  ChangeMetrics,
  CheckResult,
  CheckRun,
  GithubLink,
  GuidedLoop,
  LaunchLine,
  Milestone,
  NotesSettings,
  ProductOrigin,
  ProductStep,
  RoomQuestion,
  RowImport,
  StudioProductState,
  Suggestion,
  Understood,
  Variant,
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
  s.lastRequestFailure ??= null;
  s.launchPermission ??= "UNKNOWN";
  s.suggestions ??= [];
  s.suggestions.forEach(normalizeSuggestion);
  s.github = normalizeGithub(s.github);
  s.liveBeforeVersions ??= null;
  s.changes ??= [];
  s.changes.forEach(normalizeChange);
  s.versions ??= [];
  s.versions.forEach(normalizeVersion);
  s.origins ??= [];
  s.origins.forEach(normalizeOrigin);
  s.notes = normalizeNotes(s.notes);
  s.publicSource ??= null;
  s.sourceNoticeAcceptedAt ??= null;
  s.understood = normalizeUnderstood(s.understood);
  s.explainersSeen ??= [];
  s.guidedLoop = normalizeGuidedLoop(s.guidedLoop);
  s.rowImports ??= [];
  s.rowImports.forEach((rowImport: RowImport) => {
    const r: Partial<RowImport> = rowImport;
    r.imported ??= 0;
    r.failure ??= null;
  });
  return state;
}

function normalizeUnderstood(
  understood: Understood | null | undefined,
): Understood | null {
  if (!understood) return null;
  const u: Partial<Understood> = understood;
  u.materials ??= [];
  return understood;
}

function normalizeGuidedLoop(loop: GuidedLoop | undefined): GuidedLoop {
  if (!loop) return { status: "NOT_STARTED", at: null };
  const l: Partial<GuidedLoop> = loop;
  l.status ??= "NOT_STARTED";
  l.at ??= null;
  return loop;
}

function normalizeCost(cost: ChangeCost | null | undefined): ChangeCost | null {
  if (!cost) return null;
  const c: Partial<ChangeCost> = cost;
  c.startUsd ??= null;
  c.endUsd ??= null;
  return cost;
}

function normalizeQuestion(question: RoomQuestion): void {
  const q: Partial<RoomQuestion> = question;
  q.answer ??= null;
  q.answeredAt ??= null;
  q.answeredBy ??= null;
}

function normalizeSuggestion(suggestion: Suggestion): void {
  const x: Partial<Suggestion> = suggestion;
  x.kind ??= "IDEA";
  x.screenshot ??= null;
}

function normalizeOrigin(origin: ProductOrigin): void {
  const o: Partial<ProductOrigin> = origin;
  o.sourceUrl ??= null;
  o.sourceRef ??= null;
  o.missing ??= [];
  o.latestVersion ??= null;
  o.checkedAt ??= null;
}

function normalizeNotes(notes: NotesSettings | undefined): NotesSettings {
  if (!notes) return { enabled: false, since: null };
  const n: Partial<NotesSettings> = notes;
  n.enabled ??= false;
  n.since ??= null;
  return notes;
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
  c.milestones.forEach((milestone: Milestone) => {
    const m: Partial<Milestone> = milestone;
    m.outcome ??= null;
  });
  c.checkRuns ??= [];
  c.checkRuns.forEach(normalizeRun);
  c.stuck ??= null;
  c.lintWaivedAt ??= null;
  c.metrics = normalizeMetrics(c.metrics);
  c.variants ??= [];
  c.variants.forEach((variant: Variant) => {
    const v: Partial<Variant> = variant;
    v.chatSessionId ??= null;
    v.summary ??= null;
  });
  c.questions ??= [];
  c.questions.forEach(normalizeQuestion);
  c.cost = normalizeCost(c.cost);
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
