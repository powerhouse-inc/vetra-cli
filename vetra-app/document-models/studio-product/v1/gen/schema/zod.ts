/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddMilestoneInput,
  AdoptExistingInput,
  Change,
  ChangeKind,
  ChangeMetrics,
  ChangeStatus,
  CheckKind,
  CheckResult,
  CheckResultInput,
  CheckRun,
  ClearRequestInput,
  ClearStuckInput,
  CompleteLaunchInput,
  CompleteLaunchPackageInput,
  CompleteStepInput,
  CountStepInput,
  DiscardChangeInput,
  DismissSuggestionInput,
  FailLaunchInput,
  FailRequestInput,
  GithubLink,
  GithubStatus,
  InitProductInput,
  LaunchLine,
  LaunchLineKind,
  LineStatus,
  LiveBeforeVersions,
  LiveHealth,
  MarkStuckInput,
  Milestone,
  PackageVersion,
  PauseChangeInput,
  PendingRequest,
  PermissionState,
  PlanStepInput,
  PlanStepsInput,
  ProductAccess,
  ProductStep,
  RecordChangeMetricsInput,
  RecordCheckRunInput,
  RenameProductInput,
  ReopenStepInput,
  RequestDiscardInput,
  RequestFailure,
  RequestKind,
  RequestLaunchInput,
  RequestMirrorInput,
  RequestRestartInput,
  RequestRollbackInput,
  ResumeChangeInput,
  SetAccessInput,
  SetChangeTitleInput,
  SetHealthInput,
  SetLaunchLineInput,
  SetLaunchPermissionInput,
  SetLiveBeforeVersionsInput,
  SetLiveTargetInput,
  SetLiveVersionInput,
  SetProductDriveInput,
  SetStepAttentionInput,
  SetSuggestionsInput,
  SetSuggestionsItemInput,
  StartChangeInput,
  StartLaunchInput,
  StartStepInput,
  StepKind,
  StepStatus,
  Stuck,
  StudioProductState,
  Suggestion,
  SuggestionStatus,
  UseSuggestionInput,
  Version,
  VersionStatus,
  WaiveLintInput,
} from "./types.js";

type Properties<T> = Required<{
  [K in keyof T]: z.ZodType<T[K]>;
}>;

type definedNonNullAny = {};

export const isDefinedNonNullAny = (v: any): v is definedNonNullAny =>
  v !== undefined && v !== null;

export const definedNonNullAnySchema = z
  .any()
  .refine((v) => isDefinedNonNullAny(v));

export const ChangeKindSchema = z.enum([
  "BEFORE_VERSIONS",
  "CHANGE",
  "FIRST_BUILD",
  "UNDO",
]);

export const ChangeStatusSchema = z.enum([
  "BUILDING",
  "CLOSED",
  "DISCARDED",
  "FAILED",
  "LAUNCHED",
  "LAUNCHING",
  "PAUSED",
  "READY",
]);

export const CheckKindSchema = z.enum([
  "GENERATE",
  "LINT",
  "REDUCER_TESTS",
  "SMOKE",
  "TYPECHECK",
]);

export const GithubStatusSchema = z.enum([
  "CONNECTED",
  "DISCONNECTED",
  "NOT_CONNECTED",
  "PUSH_FAILED",
]);

export const LaunchLineKindSchema = z.enum([
  "DEPLOY",
  "MIRROR",
  "PUBLISH",
  "SNAPSHOT",
  "VERIFY",
]);

export const LineStatusSchema = z.enum([
  "DONE",
  "FAILED",
  "RUNNING",
  "SKIPPED",
  "WAITING",
]);

export const LiveHealthSchema = z.enum(["HEALTHY", "UNHEALTHY", "UNKNOWN"]);

export const PermissionStateSchema = z.enum([
  "EXPIRED",
  "GRANTED",
  "MISSING",
  "UNKNOWN",
]);

export const ProductAccessSchema = z.enum(["OWNER_ONLY", "SIGNED_IN"]);

export const RequestKindSchema = z.enum([
  "DISCARD",
  "LAUNCH",
  "MIRROR",
  "RESTART",
  "ROLLBACK",
]);

export const StepKindSchema = z.enum([
  "DATA",
  "EDITORS",
  "LIVE",
  "PLAN",
  "TESTS",
]);

export const StepStatusSchema = z.enum([
  "DONE",
  "LIVE",
  "NEEDS_YOU",
  "NOT_STARTED",
  "STOPPED",
  "WORKING",
]);

export const SuggestionStatusSchema = z.enum(["DISMISSED", "OPEN", "USED"]);

export const VersionStatusSchema = z.enum([
  "FAILED",
  "LAUNCHING",
  "LIVE",
  "PREVIOUS",
]);

export function AddMilestoneInputSchema(): z.ZodObject<
  Properties<AddMilestoneInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    id: z.string(),
    recovered: z.boolean().nullish(),
    text: z.string(),
  });
}

export function AdoptExistingInputSchema(): z.ZodObject<
  Properties<AdoptExistingInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    chatSessionIds: z.array(z.string()),
    doneSteps: z.array(StepKindSchema),
    request: z.string(),
  });
}

export function ChangeSchema(): z.ZodObject<Properties<Change>> {
  return z.object({
    __typename: z.literal("Change").optional(),
    chatSessionId: z.string().nullish(),
    chatSessionIds: z.array(z.string()),
    checkRuns: z.array(z.lazy(() => CheckRunSchema())),
    id: z.string(),
    kind: ChangeKindSchema,
    lintWaivedAt: z.iso.datetime().nullish(),
    metrics: z.lazy(() => ChangeMetricsSchema()),
    milestones: z.array(z.lazy(() => MilestoneSchema())),
    request: z.string(),
    startedAt: z.iso.datetime(),
    status: ChangeStatusSchema,
    steps: z.array(z.lazy(() => ProductStepSchema())),
    stuck: z.lazy(() => StuckSchema().nullish()),
    title: z.string().nullish(),
  });
}

export function ChangeMetricsSchema(): z.ZodObject<Properties<ChangeMetrics>> {
  return z.object({
    __typename: z.literal("ChangeMetrics").optional(),
    firstPreviewAt: z.iso.datetime().nullish(),
    liveAt: z.iso.datetime().nullish(),
    readyAt: z.iso.datetime().nullish(),
    steps: z.number(),
  });
}

export function CheckResultSchema(): z.ZodObject<Properties<CheckResult>> {
  return z.object({
    __typename: z.literal("CheckResult").optional(),
    kind: CheckKindSchema,
    passed: z.boolean(),
    reason: z.string().nullish(),
  });
}

export function CheckResultInputSchema(): z.ZodObject<
  Properties<CheckResultInput>
> {
  return z.object({
    kind: CheckKindSchema,
    passed: z.boolean(),
    reason: z.string().nullish(),
  });
}

export function CheckRunSchema(): z.ZodObject<Properties<CheckRun>> {
  return z.object({
    __typename: z.literal("CheckRun").optional(),
    at: z.iso.datetime(),
    id: z.string(),
    results: z.array(z.lazy(() => CheckResultSchema())),
  });
}

export function ClearRequestInputSchema(): z.ZodObject<
  Properties<ClearRequestInput>
> {
  return z.object({
    _: z.boolean().nullish(),
  });
}

export function ClearStuckInputSchema(): z.ZodObject<
  Properties<ClearStuckInput>
> {
  return z.object({
    changeId: z.string(),
  });
}

export function CompleteLaunchInputSchema(): z.ZodObject<
  Properties<CompleteLaunchInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changedFiles: z.array(z.string()),
    deploymentId: z.string(),
    gitTag: z.string(),
    launchedBy: z.string(),
    number: z.number(),
    packages: z.array(z.lazy(() => CompleteLaunchPackageInputSchema())),
    sha: z.string(),
    summary: z.string().nullish(),
    title: z.string(),
    trigger: z.string(),
  });
}

export function CompleteLaunchPackageInputSchema(): z.ZodObject<
  Properties<CompleteLaunchPackageInput>
> {
  return z.object({
    name: z.string(),
    version: z.string(),
  });
}

export function CompleteStepInputSchema(): z.ZodObject<
  Properties<CompleteStepInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    kind: StepKindSchema,
  });
}

export function CountStepInputSchema(): z.ZodObject<
  Properties<CountStepInput>
> {
  return z.object({
    changeId: z.string(),
    done: z.number(),
    kind: StepKindSchema,
    total: z.number(),
  });
}

export function DiscardChangeInputSchema(): z.ZodObject<
  Properties<DiscardChangeInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
  });
}

export function DismissSuggestionInputSchema(): z.ZodObject<
  Properties<DismissSuggestionInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function FailLaunchInputSchema(): z.ZodObject<
  Properties<FailLaunchInput>
> {
  return z.object({
    at: z.iso.datetime(),
    number: z.number(),
    reason: z.string(),
  });
}

export function FailRequestInputSchema(): z.ZodObject<
  Properties<FailRequestInput>
> {
  return z.object({
    at: z.iso.datetime(),
    kind: RequestKindSchema,
    reason: z.string(),
  });
}

export function GithubLinkSchema(): z.ZodObject<Properties<GithubLink>> {
  return z.object({
    __typename: z.literal("GithubLink").optional(),
    externalChangesSha: z.string().nullish(),
    lastError: z.string().nullish(),
    repoFullName: z.string().nullish(),
    status: GithubStatusSchema,
  });
}

export function InitProductInputSchema(): z.ZodObject<
  Properties<InitProductInput>
> {
  return z.object({
    createdAt: z.iso.datetime(),
    idea: z.string(),
    name: z.string(),
  });
}

export function LaunchLineSchema(): z.ZodObject<Properties<LaunchLine>> {
  return z.object({
    __typename: z.literal("LaunchLine").optional(),
    detail: z.string().nullish(),
    kind: LaunchLineKindSchema,
    status: LineStatusSchema,
  });
}

export function LiveBeforeVersionsSchema(): z.ZodObject<
  Properties<LiveBeforeVersions>
> {
  return z.object({
    __typename: z.literal("LiveBeforeVersions").optional(),
    at: z.iso.datetime(),
    environmentId: z.string(),
    url: z.url(),
  });
}

export function MarkStuckInputSchema(): z.ZodObject<
  Properties<MarkStuckInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    reason: z.string(),
    tried: z.array(z.string()),
  });
}

export function MilestoneSchema(): z.ZodObject<Properties<Milestone>> {
  return z.object({
    __typename: z.literal("Milestone").optional(),
    at: z.iso.datetime(),
    id: z.string(),
    recovered: z.boolean(),
    text: z.string(),
  });
}

export function PackageVersionSchema(): z.ZodObject<
  Properties<PackageVersion>
> {
  return z.object({
    __typename: z.literal("PackageVersion").optional(),
    name: z.string(),
    version: z.string(),
  });
}

export function PauseChangeInputSchema(): z.ZodObject<
  Properties<PauseChangeInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
  });
}

export function PendingRequestSchema(): z.ZodObject<
  Properties<PendingRequest>
> {
  return z.object({
    __typename: z.literal("PendingRequest").optional(),
    changeId: z.string().nullish(),
    kind: RequestKindSchema,
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
    targetVersion: z.number().nullish(),
  });
}

export function PlanStepInputSchema(): z.ZodObject<Properties<PlanStepInput>> {
  return z.object({
    kind: StepKindSchema,
    total: z.number().nullish(),
  });
}

export function PlanStepsInputSchema(): z.ZodObject<
  Properties<PlanStepsInput>
> {
  return z.object({
    changeId: z.string(),
    steps: z.array(z.lazy(() => PlanStepInputSchema())),
  });
}

export function ProductStepSchema(): z.ZodObject<Properties<ProductStep>> {
  return z.object({
    __typename: z.literal("ProductStep").optional(),
    done: z.number().nullish(),
    kind: StepKindSchema,
    label: z.string().nullish(),
    reason: z.string().nullish(),
    status: StepStatusSchema,
    total: z.number().nullish(),
    updatedAt: z.iso.datetime().nullish(),
  });
}

export function RecordChangeMetricsInputSchema(): z.ZodObject<
  Properties<RecordChangeMetricsInput>
> {
  return z.object({
    changeId: z.string(),
    firstPreviewAt: z.iso.datetime().nullish(),
    readyAt: z.iso.datetime().nullish(),
    steps: z.number(),
  });
}

export function RecordCheckRunInputSchema(): z.ZodObject<
  Properties<RecordCheckRunInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    id: z.string(),
    results: z.array(z.lazy(() => CheckResultInputSchema())),
  });
}

export function RenameProductInputSchema(): z.ZodObject<
  Properties<RenameProductInput>
> {
  return z.object({
    name: z.string(),
  });
}

export function ReopenStepInputSchema(): z.ZodObject<
  Properties<ReopenStepInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    kind: StepKindSchema,
    reason: z.string(),
  });
}

export function RequestDiscardInputSchema(): z.ZodObject<
  Properties<RequestDiscardInput>
> {
  return z.object({
    changeId: z.string(),
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
  });
}

export function RequestFailureSchema(): z.ZodObject<
  Properties<RequestFailure>
> {
  return z.object({
    __typename: z.literal("RequestFailure").optional(),
    at: z.iso.datetime(),
    kind: RequestKindSchema,
    reason: z.string(),
  });
}

export function RequestLaunchInputSchema(): z.ZodObject<
  Properties<RequestLaunchInput>
> {
  return z.object({
    changeId: z.string(),
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
  });
}

export function RequestMirrorInputSchema(): z.ZodObject<
  Properties<RequestMirrorInput>
> {
  return z.object({
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
  });
}

export function RequestRestartInputSchema(): z.ZodObject<
  Properties<RequestRestartInput>
> {
  return z.object({
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
  });
}

export function RequestRollbackInputSchema(): z.ZodObject<
  Properties<RequestRollbackInput>
> {
  return z.object({
    requestedAt: z.iso.datetime(),
    requestedBy: z.string(),
    versionNumber: z.number(),
  });
}

export function ResumeChangeInputSchema(): z.ZodObject<
  Properties<ResumeChangeInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
  });
}

export function SetAccessInputSchema(): z.ZodObject<
  Properties<SetAccessInput>
> {
  return z.object({
    access: ProductAccessSchema,
  });
}

export function SetChangeTitleInputSchema(): z.ZodObject<
  Properties<SetChangeTitleInput>
> {
  return z.object({
    changeId: z.string(),
    title: z.string(),
  });
}

export function SetHealthInputSchema(): z.ZodObject<
  Properties<SetHealthInput>
> {
  return z.object({
    at: z.iso.datetime(),
    health: LiveHealthSchema,
  });
}

export function SetLaunchLineInputSchema(): z.ZodObject<
  Properties<SetLaunchLineInput>
> {
  return z.object({
    detail: z.string().nullish(),
    kind: LaunchLineKindSchema,
    number: z.number(),
    status: LineStatusSchema,
  });
}

export function SetLaunchPermissionInputSchema(): z.ZodObject<
  Properties<SetLaunchPermissionInput>
> {
  return z.object({
    state: PermissionStateSchema,
  });
}

export function SetLiveBeforeVersionsInputSchema(): z.ZodObject<
  Properties<SetLiveBeforeVersionsInput>
> {
  return z.object({
    at: z.iso.datetime(),
    environmentId: z.string(),
    url: z.url(),
  });
}

export function SetLiveTargetInputSchema(): z.ZodObject<
  Properties<SetLiveTargetInput>
> {
  return z.object({
    appId: z.string(),
    liveUrl: z.url(),
    productionEnvironmentId: z.string(),
    slug: z.string(),
  });
}

export function SetLiveVersionInputSchema(): z.ZodObject<
  Properties<SetLiveVersionInput>
> {
  return z.object({
    at: z.iso.datetime(),
    deploymentId: z.string().nullish(),
    number: z.number(),
  });
}

export function SetProductDriveInputSchema(): z.ZodObject<
  Properties<SetProductDriveInput>
> {
  return z.object({
    driveId: z.string(),
    liveUrl: z.url().nullish(),
  });
}

export function SetStepAttentionInputSchema(): z.ZodObject<
  Properties<SetStepAttentionInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    kind: StepKindSchema,
    reason: z.string().nullish(),
    status: StepStatusSchema,
  });
}

export function SetSuggestionsInputSchema(): z.ZodObject<
  Properties<SetSuggestionsInput>
> {
  return z.object({
    afterVersion: z.number(),
    items: z.array(z.lazy(() => SetSuggestionsItemInputSchema())),
  });
}

export function SetSuggestionsItemInputSchema(): z.ZodObject<
  Properties<SetSuggestionsItemInput>
> {
  return z.object({
    id: z.string(),
    text: z.string(),
  });
}

export function StartChangeInputSchema(): z.ZodObject<
  Properties<StartChangeInput>
> {
  return z.object({
    chatSessionId: z.string().nullish(),
    id: z.string(),
    kind: ChangeKindSchema,
    request: z.string(),
    startedAt: z.iso.datetime(),
  });
}

export function StartLaunchInputSchema(): z.ZodObject<
  Properties<StartLaunchInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    number: z.number(),
  });
}

export function StartStepInputSchema(): z.ZodObject<
  Properties<StartStepInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
    kind: StepKindSchema,
    label: z.string().nullish(),
  });
}

export function StuckSchema(): z.ZodObject<Properties<Stuck>> {
  return z.object({
    __typename: z.literal("Stuck").optional(),
    at: z.iso.datetime(),
    reason: z.string(),
    tried: z.array(z.string()),
  });
}

export function StudioProductStateSchema(): z.ZodObject<
  Properties<StudioProductState>
> {
  return z.object({
    __typename: z.literal("StudioProductState").optional(),
    access: ProductAccessSchema,
    activeChangeId: z.string().nullish(),
    appId: z.string().nullish(),
    changes: z.array(z.lazy(() => ChangeSchema())),
    createdAt: z.iso.datetime().nullish(),
    github: z.lazy(() => GithubLinkSchema()),
    health: LiveHealthSchema,
    idea: z.string().nullish(),
    lastRequestFailure: z.lazy(() => RequestFailureSchema().nullish()),
    launchPermission: PermissionStateSchema,
    liveBeforeVersions: z.lazy(() => LiveBeforeVersionsSchema().nullish()),
    liveDeploymentId: z.string().nullish(),
    liveSince: z.iso.datetime().nullish(),
    liveUrl: z.url().nullish(),
    liveVersion: z.number().nullish(),
    name: z.string().nullish(),
    pendingRequest: z.lazy(() => PendingRequestSchema().nullish()),
    productDriveId: z.string().nullish(),
    productionEnvironmentId: z.string().nullish(),
    slug: z.string().nullish(),
    suggestions: z.array(z.lazy(() => SuggestionSchema())),
    versions: z.array(z.lazy(() => VersionSchema())),
  });
}

export function SuggestionSchema(): z.ZodObject<Properties<Suggestion>> {
  return z.object({
    __typename: z.literal("Suggestion").optional(),
    afterVersion: z.number(),
    id: z.string(),
    status: SuggestionStatusSchema,
    text: z.string(),
  });
}

export function UseSuggestionInputSchema(): z.ZodObject<
  Properties<UseSuggestionInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function VersionSchema(): z.ZodObject<Properties<Version>> {
  return z.object({
    __typename: z.literal("Version").optional(),
    changeId: z.string().nullish(),
    changedFiles: z.array(z.string()),
    deploymentId: z.string().nullish(),
    failure: z.string().nullish(),
    gitTag: z.string(),
    launchedAt: z.iso.datetime().nullish(),
    launchedBy: z.string(),
    lines: z.array(z.lazy(() => LaunchLineSchema())),
    number: z.number(),
    packages: z.array(z.lazy(() => PackageVersionSchema())),
    rollbackBlockedReason: z.string().nullish(),
    sha: z.string(),
    status: VersionStatusSchema,
    summary: z.string().nullish(),
    title: z.string(),
    trigger: z.string(),
  });
}

export function WaiveLintInputSchema(): z.ZodObject<
  Properties<WaiveLintInput>
> {
  return z.object({
    at: z.iso.datetime(),
    changeId: z.string(),
  });
}
