export type Maybe<T> = T | null | undefined;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Address: { input: `${string}:0x${string}`; output: `${string}:0x${string}` };
  Amount: {
    input: { unit?: string; value?: number };
    output: { unit?: string; value?: number };
  };
  Amount_Crypto: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Currency: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Fiat: {
    input: { unit: string; value: number };
    output: { unit: string; value: number };
  };
  Amount_Money: { input: number; output: number };
  Amount_Percentage: { input: number; output: number };
  Amount_Tokens: { input: number; output: number };
  AttachmentRef: {
    input: `attachment://v${number}:${string}`;
    output: `attachment://v${number}:${string}`;
  };
  Currency: { input: string; output: string };
  Date: { input: string; output: string };
  DateTime: { input: string; output: string };
  EmailAddress: { input: string; output: string };
  EthereumAddress: { input: string; output: string };
  OID: { input: string; output: string };
  OLabel: { input: string; output: string };
  PHID: { input: string; output: string };
  URL: { input: string; output: string };
  Unknown: { input: unknown; output: unknown };
  Upload: { input: File; output: File };
};

export type AddMilestoneInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  id: Scalars["OID"]["input"];
  recovered?: InputMaybe<Scalars["Boolean"]["input"]>;
  text: Scalars["String"]["input"];
};

export type AdoptExistingInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  chatSessionIds: Array<Scalars["PHID"]["input"]>;
  doneSteps: Array<StepKind>;
  request: Scalars["String"]["input"];
};

export type Change = {
  chatSessionId: Maybe<Scalars["PHID"]["output"]>;
  chatSessionIds: Array<Scalars["PHID"]["output"]>;
  checkRuns: Array<CheckRun>;
  id: Scalars["OID"]["output"];
  kind: ChangeKind;
  lintWaivedAt: Maybe<Scalars["DateTime"]["output"]>;
  metrics: ChangeMetrics;
  milestones: Array<Milestone>;
  request: Scalars["String"]["output"];
  startedAt: Scalars["DateTime"]["output"];
  status: ChangeStatus;
  steps: Array<ProductStep>;
  stuck: Maybe<Stuck>;
  title: Maybe<Scalars["String"]["output"]>;
};

export type ChangeKind = "BEFORE_VERSIONS" | "CHANGE" | "FIRST_BUILD" | "UNDO";

export type ChangeMetrics = {
  firstPreviewAt: Maybe<Scalars["DateTime"]["output"]>;
  liveAt: Maybe<Scalars["DateTime"]["output"]>;
  readyAt: Maybe<Scalars["DateTime"]["output"]>;
  steps: Scalars["Int"]["output"];
};

export type ChangeStatus =
  | "BUILDING"
  | "CLOSED"
  | "DISCARDED"
  | "FAILED"
  | "LAUNCHED"
  | "LAUNCHING"
  | "PAUSED"
  | "READY";

export type CheckKind =
  "GENERATE" | "LINT" | "REDUCER_TESTS" | "SMOKE" | "TYPECHECK";

export type CheckResult = {
  kind: CheckKind;
  passed: Scalars["Boolean"]["output"];
  reason: Maybe<Scalars["String"]["output"]>;
};

export type CheckResultInput = {
  kind: CheckKind;
  passed: Scalars["Boolean"]["input"];
  reason?: InputMaybe<Scalars["String"]["input"]>;
};

export type CheckRun = {
  at: Scalars["DateTime"]["output"];
  id: Scalars["OID"]["output"];
  results: Array<CheckResult>;
};

export type ClearRequestInput = {
  _?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type ClearStuckInput = {
  changeId: Scalars["OID"]["input"];
};

export type CompleteLaunchInput = {
  at: Scalars["DateTime"]["input"];
  changedFiles: Array<Scalars["String"]["input"]>;
  deploymentId: Scalars["String"]["input"];
  gitTag: Scalars["String"]["input"];
  launchedBy: Scalars["String"]["input"];
  number: Scalars["Int"]["input"];
  packages: Array<CompleteLaunchPackageInput>;
  sha: Scalars["String"]["input"];
  summary?: InputMaybe<Scalars["String"]["input"]>;
  title: Scalars["String"]["input"];
  trigger: Scalars["String"]["input"];
};

export type CompleteLaunchPackageInput = {
  name: Scalars["String"]["input"];
  version: Scalars["String"]["input"];
};

export type CompleteStepInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  kind: StepKind;
};

export type CountStepInput = {
  changeId: Scalars["OID"]["input"];
  done: Scalars["Int"]["input"];
  kind: StepKind;
  total: Scalars["Int"]["input"];
};

export type FailLaunchInput = {
  at: Scalars["DateTime"]["input"];
  number: Scalars["Int"]["input"];
  reason: Scalars["String"]["input"];
};

export type GithubLink = {
  externalChangesSha: Maybe<Scalars["String"]["output"]>;
  lastError: Maybe<Scalars["String"]["output"]>;
  repoFullName: Maybe<Scalars["String"]["output"]>;
  status: GithubStatus;
};

export type GithubStatus =
  "CONNECTED" | "DISCONNECTED" | "NOT_CONNECTED" | "PUSH_FAILED";

export type InitProductInput = {
  createdAt: Scalars["DateTime"]["input"];
  idea: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
};

export type LaunchLine = {
  detail: Maybe<Scalars["String"]["output"]>;
  kind: LaunchLineKind;
  status: LineStatus;
};

export type LaunchLineKind =
  "DEPLOY" | "MIRROR" | "PUBLISH" | "SNAPSHOT" | "VERIFY";

export type LineStatus = "DONE" | "FAILED" | "RUNNING" | "SKIPPED" | "WAITING";

export type LiveHealth = "HEALTHY" | "UNHEALTHY" | "UNKNOWN";

export type MarkStuckInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  reason: Scalars["String"]["input"];
  tried: Array<Scalars["String"]["input"]>;
};

export type Milestone = {
  at: Scalars["DateTime"]["output"];
  id: Scalars["OID"]["output"];
  recovered: Scalars["Boolean"]["output"];
  text: Scalars["String"]["output"];
};

export type PackageVersion = {
  name: Scalars["String"]["output"];
  version: Scalars["String"]["output"];
};

export type PauseChangeInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
};

export type PendingRequest = {
  changeId: Maybe<Scalars["OID"]["output"]>;
  kind: RequestKind;
  requestedAt: Scalars["DateTime"]["output"];
  requestedBy: Scalars["String"]["output"];
  targetVersion: Maybe<Scalars["Int"]["output"]>;
};

export type PermissionState = "EXPIRED" | "GRANTED" | "MISSING" | "UNKNOWN";

export type PlanStepInput = {
  kind: StepKind;
  total?: InputMaybe<Scalars["Int"]["input"]>;
};

export type PlanStepsInput = {
  changeId: Scalars["OID"]["input"];
  steps: Array<PlanStepInput>;
};

export type ProductAccess = "OWNER_ONLY" | "SIGNED_IN";

export type ProductStep = {
  done: Maybe<Scalars["Int"]["output"]>;
  kind: StepKind;
  label: Maybe<Scalars["String"]["output"]>;
  reason: Maybe<Scalars["String"]["output"]>;
  status: StepStatus;
  total: Maybe<Scalars["Int"]["output"]>;
  updatedAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type RecordChangeMetricsInput = {
  changeId: Scalars["OID"]["input"];
  firstPreviewAt?: InputMaybe<Scalars["DateTime"]["input"]>;
  readyAt?: InputMaybe<Scalars["DateTime"]["input"]>;
  steps: Scalars["Int"]["input"];
};

export type RecordCheckRunInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  id: Scalars["OID"]["input"];
  results: Array<CheckResultInput>;
};

export type RenameProductInput = {
  name: Scalars["String"]["input"];
};

export type ReopenStepInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  kind: StepKind;
  reason: Scalars["String"]["input"];
};

export type RequestDiscardInput = {
  changeId: Scalars["OID"]["input"];
  requestedAt: Scalars["DateTime"]["input"];
  requestedBy: Scalars["String"]["input"];
};

export type RequestKind =
  "DISCARD" | "LAUNCH" | "MIRROR" | "RESTART" | "ROLLBACK";

export type RequestLaunchInput = {
  changeId: Scalars["OID"]["input"];
  requestedAt: Scalars["DateTime"]["input"];
  requestedBy: Scalars["String"]["input"];
};

export type RequestMirrorInput = {
  requestedAt: Scalars["DateTime"]["input"];
  requestedBy: Scalars["String"]["input"];
};

export type RequestRestartInput = {
  requestedAt: Scalars["DateTime"]["input"];
  requestedBy: Scalars["String"]["input"];
};

export type RequestRollbackInput = {
  requestedAt: Scalars["DateTime"]["input"];
  requestedBy: Scalars["String"]["input"];
  versionNumber: Scalars["Int"]["input"];
};

export type ResumeChangeInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
};

export type SetAccessInput = {
  access: ProductAccess;
};

export type SetChangeTitleInput = {
  changeId: Scalars["OID"]["input"];
  title: Scalars["String"]["input"];
};

export type SetHealthInput = {
  at: Scalars["DateTime"]["input"];
  health: LiveHealth;
};

export type SetLaunchLineInput = {
  detail?: InputMaybe<Scalars["String"]["input"]>;
  kind: LaunchLineKind;
  number: Scalars["Int"]["input"];
  status: LineStatus;
};

export type SetLaunchPermissionInput = {
  state: PermissionState;
};

export type SetLiveTargetInput = {
  appId: Scalars["String"]["input"];
  liveUrl: Scalars["URL"]["input"];
  productionEnvironmentId: Scalars["String"]["input"];
  slug: Scalars["String"]["input"];
};

export type SetLiveVersionInput = {
  at: Scalars["DateTime"]["input"];
  number: Scalars["Int"]["input"];
};

export type SetProductDriveInput = {
  driveId: Scalars["PHID"]["input"];
  liveUrl?: InputMaybe<Scalars["URL"]["input"]>;
};

export type SetStepAttentionInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  kind: StepKind;
  reason?: InputMaybe<Scalars["String"]["input"]>;
  status: StepStatus;
};

export type StartChangeInput = {
  chatSessionId?: InputMaybe<Scalars["PHID"]["input"]>;
  id: Scalars["OID"]["input"];
  kind: ChangeKind;
  request: Scalars["String"]["input"];
  startedAt: Scalars["DateTime"]["input"];
};

export type StartLaunchInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  number: Scalars["Int"]["input"];
};

export type StartStepInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
  kind: StepKind;
  label?: InputMaybe<Scalars["String"]["input"]>;
};

export type StepKind = "DATA" | "EDITORS" | "LIVE" | "PLAN" | "TESTS";

export type StepStatus =
  "DONE" | "LIVE" | "NEEDS_YOU" | "NOT_STARTED" | "STOPPED" | "WORKING";

export type Stuck = {
  at: Scalars["DateTime"]["output"];
  reason: Scalars["String"]["output"];
  tried: Array<Scalars["String"]["output"]>;
};

export type StudioProductState = {
  access: ProductAccess;
  activeChangeId: Maybe<Scalars["OID"]["output"]>;
  appId: Maybe<Scalars["String"]["output"]>;
  changes: Array<Change>;
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  github: GithubLink;
  health: LiveHealth;
  idea: Maybe<Scalars["String"]["output"]>;
  launchPermission: PermissionState;
  liveUrl: Maybe<Scalars["URL"]["output"]>;
  liveVersion: Maybe<Scalars["Int"]["output"]>;
  name: Maybe<Scalars["String"]["output"]>;
  pendingRequest: Maybe<PendingRequest>;
  productDriveId: Maybe<Scalars["PHID"]["output"]>;
  productionEnvironmentId: Maybe<Scalars["String"]["output"]>;
  slug: Maybe<Scalars["String"]["output"]>;
  suggestions: Array<Suggestion>;
  versions: Array<Version>;
};

export type Suggestion = {
  afterVersion: Scalars["Int"]["output"];
  id: Scalars["OID"]["output"];
  status: SuggestionStatus;
  text: Scalars["String"]["output"];
};

export type SuggestionStatus = "DISMISSED" | "OPEN" | "USED";

export type Version = {
  changeId: Maybe<Scalars["OID"]["output"]>;
  changedFiles: Array<Scalars["String"]["output"]>;
  deploymentId: Maybe<Scalars["String"]["output"]>;
  failure: Maybe<Scalars["String"]["output"]>;
  gitTag: Scalars["String"]["output"];
  launchedAt: Maybe<Scalars["DateTime"]["output"]>;
  launchedBy: Scalars["String"]["output"];
  lines: Array<LaunchLine>;
  number: Scalars["Int"]["output"];
  packages: Array<PackageVersion>;
  rollbackBlockedReason: Maybe<Scalars["String"]["output"]>;
  sha: Scalars["String"]["output"];
  status: VersionStatus;
  summary: Maybe<Scalars["String"]["output"]>;
  title: Scalars["String"]["output"];
  trigger: Scalars["String"]["output"];
};

export type VersionStatus = "FAILED" | "LAUNCHING" | "LIVE" | "PREVIOUS";

export type WaiveLintInput = {
  at: Scalars["DateTime"]["input"];
  changeId: Scalars["OID"]["input"];
};
