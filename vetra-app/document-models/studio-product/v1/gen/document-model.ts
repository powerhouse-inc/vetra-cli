import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "vetra/studio-product",
  name: "Studio Product",
  extension: "vsp",
  description:
    "The Studio Product document is the single read model the Vetra Studio page renders from: the product's name, idea and live address, its changes (each with planned steps, story milestones, check runs and timings), its launched versions, live health, the pending customer request, agent suggestions and the GitHub link. One document per Studio, in the Studio drive, written by the Studio agent. Lists of ProductStep, CheckResult and LaunchLine are keyed by `kind`, Version by `number` and PackageVersion by `name` (natural keys, kept unique by the reducers). Readers should pass the state through normalizeProduct so documents made by earlier builds get every list and default.",
  author: {
    name: "Powerhouse",
    website: "https://powerhouse.inc",
  },
  specifications: [
    {
      version: 1,
      changeLog: [],
      state: {
        global: {
          schema:
            '# Studio Product: the single read model the Studio page renders from.\n# Natural keys (F54): ProductStep, CheckResult and LaunchLine are keyed by\n# their `kind`, Version by `number`, PackageVersion by `name`; reducers keep\n# them unique within their list.\n\nenum StepKind {\n  PLAN\n  DATA\n  EDITORS\n  TESTS\n  LIVE\n}\n\nenum StepStatus {\n  NOT_STARTED\n  WORKING\n  DONE\n  NEEDS_YOU\n  STOPPED\n  LIVE\n}\n\nenum ChangeKind {\n  FIRST_BUILD\n  CHANGE\n  UNDO\n  BEFORE_VERSIONS\n}\n\nenum ChangeStatus {\n  BUILDING\n  PAUSED\n  READY\n  LAUNCHING\n  LAUNCHED\n  DISCARDED\n  FAILED\n  CLOSED\n}\n\nenum CheckKind {\n  GENERATE\n  TYPECHECK\n  LINT\n  REDUCER_TESTS\n  SMOKE\n}\n\nenum ProductAccess {\n  SIGNED_IN\n  OWNER_ONLY\n}\n\nenum LiveHealth {\n  UNKNOWN\n  HEALTHY\n  UNHEALTHY\n}\n\nenum PermissionState {\n  UNKNOWN\n  GRANTED\n  MISSING\n  EXPIRED\n}\n\nenum RequestKind {\n  LAUNCH\n  ROLLBACK\n  DISCARD\n  RESTART\n  MIRROR\n}\n\nenum VersionStatus {\n  LAUNCHING\n  LIVE\n  PREVIOUS\n  FAILED\n}\n\nenum LaunchLineKind {\n  SNAPSHOT\n  PUBLISH\n  DEPLOY\n  VERIFY\n  MIRROR\n}\n\nenum LineStatus {\n  WAITING\n  RUNNING\n  DONE\n  FAILED\n  SKIPPED\n}\n\nenum SuggestionStatus {\n  OPEN\n  USED\n  DISMISSED\n}\n\nenum SuggestionKind {\n  IDEA\n  REVIEW\n}\n\nenum VariantLabel {\n  A\n  B\n}\n\nenum VariantStatus {\n  BUILDING\n  READY\n  FAILED\n  KEPT\n  DISCARDED\n}\n\nenum OriginMode {\n  REMIX\n  COMPOSE\n}\n\nenum PublicSourceKind {\n  GITHUB\n  PACKAGE\n}\n\nenum MaterialKind {\n  PICTURE\n  PDF\n  SHEET\n  TEXT\n}\n\nenum GuidedLoopStatus {\n  NOT_STARTED\n  POINTED\n  CHANGED\n  WENT_BACK\n  DONE\n  DISMISSED\n}\n\nenum RowImportStatus {\n  CONFIRMED\n  DONE\n  FAILED\n}\n\nenum QuestionAnswerBy {\n  ROOM\n  DEFAULT\n}\n\nenum GithubStatus {\n  NOT_CONNECTED\n  CONNECTED\n  DISCONNECTED\n  PUSH_FAILED\n}\n\ntype ProductStep {\n  kind: StepKind!\n  status: StepStatus!\n  done: Int\n  total: Int\n  label: String\n  reason: String\n  updatedAt: DateTime\n}\n\ntype Milestone {\n  id: OID!\n  text: String!\n  at: DateTime!\n  recovered: Boolean!\n  # One customer-facing sentence (<= 120 chars) for the Outcome layer.\n  outcome: String\n}\n\ntype CheckResult {\n  kind: CheckKind!\n  passed: Boolean!\n  reason: String\n}\n\ntype CheckRun {\n  id: OID!\n  at: DateTime!\n  results: [CheckResult!]!\n}\n\ntype Stuck {\n  reason: String!\n  tried: [String!]!\n  at: DateTime!\n}\n\ntype ChangeMetrics {\n  steps: Int!\n  firstPreviewAt: DateTime\n  readyAt: DateTime\n  liveAt: DateTime\n}\n\ntype Change {\n  id: OID!\n  kind: ChangeKind!\n  request: String!\n  title: String\n  chatSessionId: PHID\n  chatSessionIds: [PHID!]!\n  status: ChangeStatus!\n  startedAt: DateTime!\n  steps: [ProductStep!]!\n  milestones: [Milestone!]!\n  checkRuns: [CheckRun!]!\n  stuck: Stuck\n  metrics: ChangeMetrics!\n  lintWaivedAt: DateTime\n  variants: [Variant!]!\n  questions: [RoomQuestion!]!\n  cost: ChangeCost\n}\n\n# One of two ways to build a change ("Show me two ways"), on its own branch.\ntype Variant {\n  label: VariantLabel!\n  branch: String!\n  status: VariantStatus!\n  chatSessionId: PHID\n  summary: String\n}\n\ntype PackageVersion {\n  name: String!\n  version: String!\n}\n\ntype LaunchLine {\n  kind: LaunchLineKind!\n  status: LineStatus!\n  detail: String\n}\n\ntype Version {\n  number: Int!\n  title: String!\n  summary: String\n  changeId: OID\n  gitTag: String!\n  sha: String!\n  packages: [PackageVersion!]!\n  deploymentId: String\n  launchedAt: DateTime\n  launchedBy: String!\n  trigger: String!\n  status: VersionStatus!\n  lines: [LaunchLine!]!\n  changedFiles: [String!]!\n  failure: String\n  rollbackBlockedReason: String\n}\n\ntype PendingRequest {\n  kind: RequestKind!\n  changeId: OID\n  targetVersion: Int\n  requestedAt: DateTime!\n  requestedBy: String!\n}\n\ntype RequestFailure {\n  kind: RequestKind!\n  reason: String!\n  at: DateTime!\n}\n\ntype Suggestion {\n  id: OID!\n  text: String!\n  afterVersion: Int!\n  status: SuggestionStatus!\n  kind: SuggestionKind!\n  # Attachment ref or URL of the screen a review finding is about.\n  screenshot: String\n}\n\ntype GithubLink {\n  status: GithubStatus!\n  repoFullName: String\n  lastError: String\n  externalChangesSha: String\n}\n\n# An environment that already ran this workspace\'s packages before the\n# product had versions (spec 6.6): shown as live until Version 1.\ntype LiveBeforeVersions {\n  environmentId: String!\n  url: URL!\n  at: DateTime!\n}\n\n# A published package this product was remixed from or composes (keyed by\n# packageName).\ntype ProductOrigin {\n  packageName: String!\n  version: String!\n  mode: OriginMode!\n  license: String!\n  sourceUrl: URL\n  sourceRef: String\n  at: DateTime!\n  missing: [String!]!\n  latestVersion: String\n  checkedAt: DateTime\n}\n\n# Notes from people using the live product (opt-in).\ntype NotesSettings {\n  enabled: Boolean!\n  since: DateTime\n}\n\ntype PublicSource {\n  kind: PublicSourceKind!\n  url: URL!\n  version: Int!\n}\n\n# A question the agent asks the room while building a change; answered by\n# the room or, after a while, by its default.\ntype RoomQuestion {\n  id: OID!\n  text: String!\n  options: [String!]!\n  defaultAnswer: String!\n  language: String!\n  askedAt: DateTime!\n  answer: String\n  answeredAt: DateTime\n  answeredBy: QuestionAnswerBy\n}\n\n# What a change cost in model usage, in US dollars: the meter at its start\n# and at its end.\ntype ChangeCost {\n  startUsd: Float\n  endUsd: Float\n}\n\n# A material (picture, PDF, sheet, text) the understanding was built from.\ntype MaterialRef {\n  id: OID!\n  name: String!\n  kind: MaterialKind!\n}\n\n# What the agent understood from the idea and the materials, confirmed with\n# "Build this".\ntype Understood {\n  json: String!\n  language: String!\n  at: DateTime!\n  materials: [MaterialRef!]!\n}\n\n# Progress through the guided first loop (point, change, go back, done).\ntype GuidedLoop {\n  status: GuidedLoopStatus!\n  at: DateTime\n}\n\n# Rows of a sheet imported as documents.\ntype RowImport {\n  id: OID!\n  materialId: OID!\n  sheet: String!\n  documentType: String!\n  rows: Int!\n  imported: Int!\n  status: RowImportStatus!\n  at: DateTime!\n  failure: String\n}\n\ntype StudioProductState {\n  name: String\n  idea: String\n  slug: String\n  liveUrl: URL\n  appId: String\n  productionEnvironmentId: String\n  productDriveId: PHID\n  createdAt: DateTime\n  access: ProductAccess!\n  changes: [Change!]!\n  activeChangeId: OID\n  liveVersion: Int\n  liveSince: DateTime\n  liveDeploymentId: String\n  versions: [Version!]!\n  health: LiveHealth!\n  pendingRequest: PendingRequest\n  lastRequestFailure: RequestFailure\n  launchPermission: PermissionState!\n  suggestions: [Suggestion!]!\n  github: GithubLink!\n  liveBeforeVersions: LiveBeforeVersions\n  origins: [ProductOrigin!]!\n  notes: NotesSettings!\n  publicSource: PublicSource\n  sourceNoticeAcceptedAt: DateTime\n  understood: Understood\n  explainersSeen: [String!]!\n  guidedLoop: GuidedLoop!\n  rowImports: [RowImport!]!\n}\n',
          initialValue:
            '{\n  "name": null,\n  "idea": null,\n  "slug": null,\n  "liveUrl": null,\n  "appId": null,\n  "productionEnvironmentId": null,\n  "productDriveId": null,\n  "createdAt": null,\n  "access": "SIGNED_IN",\n  "changes": [],\n  "activeChangeId": null,\n  "liveVersion": null,\n  "liveSince": null,\n  "liveDeploymentId": null,\n  "versions": [],\n  "health": "UNKNOWN",\n  "pendingRequest": null,\n  "lastRequestFailure": null,\n  "launchPermission": "UNKNOWN",\n  "suggestions": [],\n  "github": {\n    "status": "NOT_CONNECTED",\n    "repoFullName": null,\n    "lastError": null,\n    "externalChangesSha": null\n  },\n  "liveBeforeVersions": null,\n  "origins": [],\n  "notes": {\n    "enabled": false,\n    "since": null\n  },\n  "publicSource": null,\n  "sourceNoticeAcceptedAt": null,\n  "understood": null,\n  "explainersSeen": [],\n  "guidedLoop": {\n    "status": "NOT_STARTED",\n    "at": null\n  },\n  "rowImports": []\n}',
          examples: [],
        },
        local: {
          schema: "",
          initialValue: "",
          examples: [],
        },
      },
      modules: [
        {
          id: "mod-product",
          name: "product",
          description: "Product identity and access.",
          operations: [
            {
              id: "op-init-product",
              name: "INIT_PRODUCT",
              description:
                "Initialise the product with its first name, the customer's idea and the creation time.",
              schema:
                "input InitProductInput {\n  name: String!\n  idea: String!\n  createdAt: DateTime!\n}",
              template:
                "Initialise the product with its first name, the customer's idea and the creation time.",
              reducer: "",
              errors: [
                {
                  id: "err-product-already-initialized",
                  name: "ProductAlreadyInitializedError",
                  code: "PRODUCT_ALREADY_INITIALIZED",
                  description: "The product was already initialised.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-rename-product",
              name: "RENAME_PRODUCT",
              description: "Set the product name.",
              schema: "input RenameProductInput {\n  name: String!\n}",
              template: "Set the product name.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-access",
              name: "SET_ACCESS",
              description: "Set who may open the live product.",
              schema: "input SetAccessInput {\n  access: ProductAccess!\n}",
              template: "Set who may open the live product.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-change",
          name: "change",
          description:
            "Changes: steps, story milestones, check runs, gates and readiness.",
          operations: [
            {
              id: "op-start-change",
              name: "START_CHANGE",
              description:
                "Start a new change (first build, change or undo) and make it the active change.",
              schema:
                "input StartChangeInput {\n  id: OID!\n  kind: ChangeKind!\n  request: String!\n  chatSessionId: PHID\n  startedAt: DateTime!\n}",
              template:
                "Start a new change (first build, change or undo) and make it the active change.",
              reducer: "",
              errors: [
                {
                  id: "err-change-in-progress",
                  name: "ChangeInProgressError",
                  code: "CHANGE_IN_PROGRESS",
                  description:
                    "Another change is still building, paused, ready or launching.",
                  template: "",
                },
                {
                  id: "err-duplicate-change-id",
                  name: "DuplicateChangeIdError",
                  code: "DUPLICATE_CHANGE_ID",
                  description: "A change with this id already exists.",
                  template: "",
                },
                {
                  id: "err-invalid-change-kind",
                  name: "InvalidChangeKindError",
                  code: "INVALID_CHANGE_KIND",
                  description:
                    "BEFORE_VERSIONS changes can only be created with ADOPT_EXISTING.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-adopt-existing",
              name: "ADOPT_EXISTING",
              description:
                "Adopt a Studio built before versions existed: creates one CLOSED BEFORE_VERSIONS change with the listed steps DONE and the others NOT_STARTED. Gate-exempt by design (no check runs exist for that work); leaves activeChangeId null.",
              schema:
                "input AdoptExistingInput {\n  changeId: OID!\n  request: String!\n  chatSessionIds: [PHID!]!\n  doneSteps: [StepKind!]!\n  at: DateTime!\n}",
              template:
                "Adopt a Studio built before versions existed: creates one CLOSED BEFORE_VERSIONS change with the listed steps DONE and the others NOT_STARTED. Gate-exempt by design (no check runs exist for that work); leaves activeChangeId null.",
              reducer: "",
              errors: [
                {
                  id: "err-adopt-not-allowed",
                  name: "AdoptNotAllowedError",
                  code: "ADOPT_NOT_ALLOWED",
                  description: "The product already has changes.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-live-before-versions",
              name: "SET_LIVE_BEFORE_VERSIONS",
              description:
                "Record the environment that already runs this workspace's packages from before versions (existing Studios, spec 6.6). Allowed only on a product adopted with ADOPT_EXISTING that has no version yet.",
              schema:
                "input SetLiveBeforeVersionsInput {\n  environmentId: String!\n  url: URL!\n  at: DateTime!\n}",
              template:
                "Record the environment that already runs this workspace's packages from before versions.",
              reducer: "",
              errors: [
                {
                  id: "err-live-before-versions-not-allowed",
                  name: "LiveBeforeVersionsNotAllowedError",
                  code: "LIVE_BEFORE_VERSIONS_NOT_ALLOWED",
                  description:
                    "Only a product adopted from before versions, with no version yet, can record what was live before versions.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-plan-steps",
              name: "PLAN_STEPS",
              description:
                "Set the planned steps of a change, keeping the progress of steps that stay in the plan.",
              schema:
                "input PlanStepInput {\n  kind: StepKind!\n  total: Int\n}\n\ninput PlanStepsInput {\n  changeId: OID!\n  steps: [PlanStepInput!]!\n}",
              template:
                "Set the planned steps of a change, keeping the progress of steps that stay in the plan.",
              reducer: "",
              errors: [
                {
                  id: "err-change-not-found",
                  name: "ChangeNotFoundError",
                  code: "CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-invalid-change-status",
                  name: "InvalidChangeStatusError",
                  code: "INVALID_CHANGE_STATUS",
                  description:
                    "The change's status does not allow this operation (it is closed, or not in the status the operation needs).",
                  template: "",
                },
                {
                  id: "err-duplicate-step-kind",
                  name: "DuplicateStepKindError",
                  code: "DUPLICATE_STEP_KIND",
                  description: "A step kind is listed more than once.",
                  template: "",
                },
                {
                  id: "err-invalid-count",
                  name: "InvalidCountError",
                  code: "INVALID_COUNT",
                  description:
                    "Counts must be zero or more and done may not exceed total.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-start-step",
              name: "START_STEP",
              description:
                "Mark a planned step as being worked on. Starting a step of a READY change sends the change back to BUILDING.",
              schema:
                "input StartStepInput {\n  changeId: OID!\n  kind: StepKind!\n  label: String\n  at: DateTime!\n}",
              template:
                "Mark a planned step as being worked on. Starting a step of a READY change sends the change back to BUILDING.",
              reducer: "",
              errors: [
                {
                  id: "err-step-not-planned",
                  name: "StepNotPlannedError",
                  code: "STEP_NOT_PLANNED",
                  description: "The step is not part of the change's plan.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-count-step",
              name: "COUNT_STEP",
              description:
                "Record how many items of a step are done out of the total.",
              schema:
                "input CountStepInput {\n  changeId: OID!\n  kind: StepKind!\n  done: Int!\n  total: Int!\n}",
              template:
                "Record how many items of a step are done out of the total.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-complete-step",
              name: "COMPLETE_STEP",
              description:
                "Mark a step done. DATA needs the latest GENERATE passed, EDITORS the latest SMOKE passed, TESTS the latest result of every check kind passed (LINT may be waived) with TYPECHECK and SMOKE no older than GENERATE. Clears stuck; the change becomes READY when every planned step except LIVE is done.",
              schema:
                "input CompleteStepInput {\n  changeId: OID!\n  kind: StepKind!\n  at: DateTime!\n}",
              template:
                "Mark a step done. DATA needs the latest GENERATE passed, EDITORS the latest SMOKE passed, TESTS the latest result of every check kind passed (LINT may be waived) with TYPECHECK and SMOKE no older than GENERATE. Clears stuck; the change becomes READY when every planned step except LIVE is done.",
              reducer: "",
              errors: [
                {
                  id: "err-gate-not-met",
                  name: "GateNotMetError",
                  code: "GATE_NOT_MET",
                  description:
                    "The step's check gate is not met by this change's check runs.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-reopen-step",
              name: "REOPEN_STEP",
              description:
                "Move a DONE step back to WORKING with the reason. A READY change goes back to BUILDING.",
              schema:
                "input ReopenStepInput {\n  changeId: OID!\n  kind: StepKind!\n  reason: String!\n  at: DateTime!\n}",
              template:
                "Move a DONE step back to WORKING with the reason. A READY change goes back to BUILDING.",
              reducer: "",
              errors: [
                {
                  id: "err-step-not-done",
                  name: "StepNotDoneError",
                  code: "STEP_NOT_DONE",
                  description: "Only a DONE step can be reopened.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-add-milestone",
              name: "ADD_MILESTONE",
              description:
                "Add a story line to a change, optionally with a customer-facing outcome sentence. Clears stuck.",
              schema:
                "input AddMilestoneInput {\n  changeId: OID!\n  id: OID!\n  text: String!\n  recovered: Boolean\n  outcome: String\n  at: DateTime!\n}",
              template:
                "Add a story line to a change, optionally with a customer-facing outcome sentence. Clears stuck.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-milestone-id",
                  name: "DuplicateMilestoneIdError",
                  code: "DUPLICATE_MILESTONE_ID",
                  description: "A milestone with this id already exists.",
                  template: "",
                },
                {
                  id: "err-outcome-too-long",
                  name: "OutcomeTooLongError",
                  code: "OUTCOME_TOO_LONG",
                  description: "An outcome is longer than 120 characters.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-record-check-run",
              name: "RECORD_CHECK_RUN",
              description: "Record the results of a check run in a change.",
              schema:
                "input CheckResultInput {\n  kind: CheckKind!\n  passed: Boolean!\n  reason: String\n}\n\ninput RecordCheckRunInput {\n  changeId: OID!\n  id: OID!\n  at: DateTime!\n  results: [CheckResultInput!]!\n}",
              template: "Record the results of a check run in a change.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-check-run-id",
                  name: "DuplicateCheckRunIdError",
                  code: "DUPLICATE_CHECK_RUN_ID",
                  description: "A check run with this id already exists.",
                  template: "",
                },
                {
                  id: "err-duplicate-check-kind",
                  name: "DuplicateCheckKindError",
                  code: "DUPLICATE_CHECK_KIND",
                  description:
                    "A check kind appears more than once in one run.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-mark-stuck",
              name: "MARK_STUCK",
              description:
                "Record that the agent is stuck, with what it tried.",
              schema:
                "input MarkStuckInput {\n  changeId: OID!\n  reason: String!\n  tried: [String!]!\n  at: DateTime!\n}",
              template: "Record that the agent is stuck, with what it tried.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-clear-stuck",
              name: "CLEAR_STUCK",
              description: "Clear the stuck marker of a change.",
              schema: "input ClearStuckInput {\n  changeId: OID!\n}",
              template: "Clear the stuck marker of a change.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-step-attention",
              name: "SET_STEP_ATTENTION",
              description:
                "Set a step to NEEDS_YOU, STOPPED or WORKING with an optional reason.",
              schema:
                "input SetStepAttentionInput {\n  changeId: OID!\n  kind: StepKind!\n  status: StepStatus!\n  reason: String\n  at: DateTime!\n}",
              template:
                "Set a step to NEEDS_YOU, STOPPED or WORKING with an optional reason.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-attention-status",
                  name: "InvalidAttentionStatusError",
                  code: "INVALID_ATTENTION_STATUS",
                  description:
                    "Only NEEDS_YOU, STOPPED or WORKING can be set as attention.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-pause-change",
              name: "PAUSE_CHANGE",
              description: "Pause a BUILDING change.",
              schema:
                "input PauseChangeInput {\n  changeId: OID!\n  at: DateTime!\n}",
              template: "Pause a BUILDING change.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-resume-change",
              name: "RESUME_CHANGE",
              description:
                "Resume a PAUSED change (it becomes READY right away when every planned step except LIVE is done).",
              schema:
                "input ResumeChangeInput {\n  changeId: OID!\n  at: DateTime!\n}",
              template:
                "Resume a PAUSED change (it becomes READY right away when every planned step except LIVE is done).",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-record-change-metrics",
              name: "RECORD_CHANGE_METRICS",
              description: "Record the step count and timings of a change.",
              schema:
                "input RecordChangeMetricsInput {\n  changeId: OID!\n  steps: Int!\n  firstPreviewAt: DateTime\n  readyAt: DateTime\n}",
              template: "Record the step count and timings of a change.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-change-title",
              name: "SET_CHANGE_TITLE",
              description: "Set the short title of a change.",
              schema:
                "input SetChangeTitleInput {\n  changeId: OID!\n  title: String!\n}",
              template: "Set the short title of a change.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-waive-lint",
              name: "WAIVE_LINT",
              description:
                "Accept lint findings for this change (Go live anyway). Only allowed when LINT is the only failing check kind.",
              schema:
                "input WaiveLintInput {\n  changeId: OID!\n  at: DateTime!\n}",
              template:
                "Accept lint findings for this change (Go live anyway). Only allowed when LINT is the only failing check kind.",
              reducer: "",
              errors: [
                {
                  id: "err-nothing-to-waive",
                  name: "NothingToWaiveError",
                  code: "NOTHING_TO_WAIVE",
                  description: "The latest failing results are not LINT only.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-discard-change",
              name: "DISCARD_CHANGE",
              description:
                "Mark a change DISCARDED once the agent has thrown its code away. A discarded change never goes live by itself.",
              schema:
                "input DiscardChangeInput {\n  changeId: OID!\n  at: DateTime!\n}",
              template:
                "Mark a change DISCARDED once the agent has thrown its code away. A discarded change never goes live by itself.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-change-status",
                  name: "InvalidChangeStatusError",
                  code: "INVALID_CHANGE_STATUS",
                  description:
                    "The change's status does not allow this operation (it is closed, or not in the status the operation needs).",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-launch",
          name: "launch",
          description:
            "Launches, versions, the live target and requests from the browser to the agent.",
          operations: [
            {
              id: "op-set-live-target",
              name: "SET_LIVE_TARGET",
              description:
                "Record the App, its production environment, the slug and the live address. Free to overwrite until the first launch; afterwards the slug is fixed.",
              schema:
                "input SetLiveTargetInput {\n  appId: String!\n  productionEnvironmentId: String!\n  slug: String!\n  liveUrl: URL!\n}",
              template:
                "Record the App, its production environment, the slug and the live address. Free to overwrite until the first launch; afterwards the slug is fixed.",
              reducer: "",
              errors: [
                {
                  id: "err-slug-locked",
                  name: "SlugLockedError",
                  code: "SLUG_LOCKED",
                  description:
                    "The live address is fixed after the first launch; the slug can no longer change.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-product-drive",
              name: "SET_PRODUCT_DRIVE",
              description:
                "Record the product drive on the production environment (set once) and, when given, the live address that opens it.",
              schema:
                "input SetProductDriveInput {\n  driveId: PHID!\n  liveUrl: URL\n}",
              template:
                "Record the product drive on the production environment (set once) and, when given, the live address that opens it.",
              reducer: "",
              errors: [
                {
                  id: "err-drive-already-set",
                  name: "DriveAlreadySetError",
                  code: "DRIVE_ALREADY_SET",
                  description:
                    "The product drive is already set to a different drive.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-request-launch",
              name: "REQUEST_LAUNCH",
              description:
                "Ask the agent to launch a READY change (Make it live / Try again).",
              schema:
                "input RequestLaunchInput {\n  changeId: OID!\n  requestedAt: DateTime!\n  requestedBy: String!\n}",
              template:
                "Ask the agent to launch a READY change (Make it live / Try again).",
              reducer: "",
              errors: [
                {
                  id: "err-request-pending",
                  name: "RequestPendingError",
                  code: "REQUEST_PENDING",
                  description:
                    "Another request is still waiting for the agent.",
                  template: "",
                },
                {
                  id: "err-change-not-ready",
                  name: "ChangeNotReadyError",
                  code: "CHANGE_NOT_READY",
                  description: "The change is not READY.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-request-rollback",
              name: "REQUEST_ROLLBACK",
              description:
                "Ask the agent to make an earlier version live again (Go back). Refused while a change is open.",
              schema:
                "input RequestRollbackInput {\n  versionNumber: Int!\n  requestedAt: DateTime!\n  requestedBy: String!\n}",
              template:
                "Ask the agent to make an earlier version live again (Go back). Refused while a change is open.",
              reducer: "",
              errors: [
                {
                  id: "err-version-not-found",
                  name: "VersionNotFoundError",
                  code: "VERSION_NOT_FOUND",
                  description: "No version with this number exists.",
                  template: "",
                },
                {
                  id: "err-invalid-version-status",
                  name: "InvalidVersionStatusError",
                  code: "INVALID_VERSION_STATUS",
                  description:
                    "The version's status does not allow this operation.",
                  template: "",
                },
                {
                  id: "err-rollback-blocked",
                  name: "RollbackBlockedError",
                  code: "ROLLBACK_BLOCKED",
                  description:
                    "The product's data can't go back to this version (its rollbackBlockedReason is set).",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-request-discard",
              name: "REQUEST_DISCARD",
              description:
                "Ask the agent to throw away an open change and reset the preview to the live code.",
              schema:
                "input RequestDiscardInput {\n  changeId: OID!\n  requestedAt: DateTime!\n  requestedBy: String!\n}",
              template:
                "Ask the agent to throw away an open change and reset the preview to the live code.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-request-restart",
              name: "REQUEST_RESTART",
              description:
                "Ask the agent to redeploy the live version as it is (Restart).",
              schema:
                "input RequestRestartInput {\n  requestedAt: DateTime!\n  requestedBy: String!\n}",
              template:
                "Ask the agent to redeploy the live version as it is (Restart).",
              reducer: "",
              errors: [
                {
                  id: "err-not-live",
                  name: "NotLiveError",
                  code: "NOT_LIVE",
                  description: "The product has no live version yet.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-request-mirror",
              name: "REQUEST_MIRROR",
              description:
                "Ask the agent to copy the code and version tags to GitHub again (Retry now).",
              schema:
                "input RequestMirrorInput {\n  requestedAt: DateTime!\n  requestedBy: String!\n}",
              template:
                "Ask the agent to copy the code and version tags to GitHub again (Retry now).",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-clear-request",
              name: "CLEAR_REQUEST",
              description:
                "Remove the pending request once the agent has handled it.",
              schema: "input ClearRequestInput {\n  _: Boolean\n}",
              template:
                "Remove the pending request once the agent has handled it.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-fail-request",
              name: "FAIL_REQUEST",
              description:
                "Record why a request (Make it live, Go back, Restart, Discard) couldn't be carried out; clears the waiting request. The next request clears the record.",
              schema:
                "input FailRequestInput {\n  kind: RequestKind!\n  reason: String!\n  at: DateTime!\n}",
              template:
                "Record why a request (Make it live, Go back, Restart, Discard) couldn't be carried out; clears the waiting request. The next request clears the record.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-start-launch",
              name: "START_LAUNCH",
              description:
                "Start launching a READY change as version `number`: the next number, or the number of a FAILED version (retry).",
              schema:
                "input StartLaunchInput {\n  number: Int!\n  changeId: OID!\n  at: DateTime!\n}",
              template:
                "Start launching a READY change as version `number`: the next number, or the number of a FAILED version (retry).",
              reducer: "",
              errors: [
                {
                  id: "err-version-number",
                  name: "VersionNumberError",
                  code: "VERSION_NUMBER",
                  description:
                    "A launch must use the next version number or the number of a failed version.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-launch-line",
              name: "SET_LAUNCH_LINE",
              description:
                "Update one line of a version's launch story (snapshot, publish, deploy, verify, mirror). An omitted detail keeps the current one.",
              schema:
                "input SetLaunchLineInput {\n  number: Int!\n  kind: LaunchLineKind!\n  status: LineStatus!\n  detail: String\n}",
              template:
                "Update one line of a version's launch story (snapshot, publish, deploy, verify, mirror). An omitted detail keeps the current one.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-complete-launch",
              name: "COMPLETE_LAUNCH",
              description:
                "Record a launched version: it becomes LIVE, the previous LIVE version becomes PREVIOUS and its change LAUNCHED.",
              schema:
                "input CompleteLaunchPackageInput {\n  name: String!\n  version: String!\n}\n\ninput CompleteLaunchInput {\n  number: Int!\n  gitTag: String!\n  sha: String!\n  packages: [CompleteLaunchPackageInput!]!\n  deploymentId: String!\n  title: String!\n  summary: String\n  changedFiles: [String!]!\n  launchedBy: String!\n  trigger: String!\n  at: DateTime!\n}",
              template:
                "Record a launched version: it becomes LIVE, the previous LIVE version becomes PREVIOUS and its change LAUNCHED.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-package-name",
                  name: "DuplicatePackageNameError",
                  code: "DUPLICATE_PACKAGE_NAME",
                  description: "A package is listed more than once.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-fail-launch",
              name: "FAIL_LAUNCH",
              description:
                "Record a failed launch with its plain reason. The change goes back to READY; the live version is untouched.",
              schema:
                "input FailLaunchInput {\n  number: Int!\n  reason: String!\n  at: DateTime!\n}",
              template:
                "Record a failed launch with its plain reason. The change goes back to READY; the live version is untouched.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-live-version",
              name: "SET_LIVE_VERSION",
              description:
                "Mark an earlier launched version as live (rollback or reconcile). Versions are never removed. `deploymentId` is the deployment now serving it (the version's own when omitted).",
              schema:
                "input SetLiveVersionInput {\n  number: Int!\n  at: DateTime!\n  deploymentId: String\n}",
              template:
                "Mark an earlier launched version as live (rollback or reconcile). Versions are never removed. `deploymentId` is the deployment now serving it (the version's own when omitted).",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-health",
              name: "SET_HEALTH",
              description: "Record the health of the live app.",
              schema:
                "input SetHealthInput {\n  health: LiveHealth!\n  at: DateTime!\n}",
              template: "Record the health of the live app.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-launch-permission",
              name: "SET_LAUNCH_PERMISSION",
              description:
                "Record whether the Studio may publish and launch on the owner's behalf.",
              schema:
                "input SetLaunchPermissionInput {\n  state: PermissionState!\n}",
              template:
                "Record whether the Studio may publish and launch on the owner's behalf.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-rollback-block",
              name: "SET_ROLLBACK_BLOCK",
              description:
                "Record whether the product's data can go back to a version (D6): `reason` is the plain sentence shown instead of Go back, null when going back is allowed. Never touches the version otherwise.",
              schema:
                "input SetRollbackBlockInput {\n  number: Int!\n  reason: String\n}",
              template:
                "Record whether the product's data can go back to a version (D6): `reason` is the plain sentence shown instead of Go back, null when going back is allowed. Never touches the version otherwise.",
              reducer: "",
              errors: [
                {
                  id: "err-version-not-found",
                  name: "VersionNotFoundError",
                  code: "VERSION_NOT_FOUND",
                  description: "No version with this number exists.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-suggestions",
          name: "suggestions",
          description:
            "The agent's ideas for the next change, offered after a launch.",
          operations: [
            {
              id: "op-set-suggestions",
              name: "SET_SUGGESTIONS",
              description:
                "Store the agent's 2\u20133 ideas for the next change, shown once the given version is live. Replaces the open ideas for that version; used and dismissed ones, and review findings, are kept.",
              schema:
                "input SetSuggestionsItemInput {\n  id: OID!\n  text: String!\n}\n\ninput SetSuggestionsInput {\n  afterVersion: Int!\n  items: [SetSuggestionsItemInput!]!\n}",
              template:
                "Store the agent's 2\u20133 ideas for the next change, shown once the given version is live. Replaces the open ideas for that version; used and dismissed ones, and review findings, are kept.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-suggestion-count",
                  name: "InvalidSuggestionCountError",
                  code: "INVALID_SUGGESTION_COUNT",
                  description: "Suggestions come in sets of 2 to 3.",
                  template: "",
                },
                {
                  id: "err-invalid-suggestion-text",
                  name: "InvalidSuggestionTextError",
                  code: "INVALID_SUGGESTION_TEXT",
                  description:
                    "A suggestion's text is empty or longer than 80 characters.",
                  template: "",
                },
                {
                  id: "err-duplicate-suggestion-id",
                  name: "DuplicateSuggestionIdError",
                  code: "DUPLICATE_SUGGESTION_ID",
                  description: "A suggestion with this id already exists.",
                  template: "",
                },
                {
                  id: "err-invalid-after-version",
                  name: "InvalidAfterVersionError",
                  code: "INVALID_AFTER_VERSION",
                  description:
                    "Suggestions follow a version number of 1 or more.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-use-suggestion",
              name: "USE_SUGGESTION",
              description:
                "Mark an open suggestion as used: the customer started a change from it.",
              schema: "input UseSuggestionInput {\n  id: OID!\n}",
              template:
                "Mark an open suggestion as used: the customer started a change from it.",
              reducer: "",
              errors: [
                {
                  id: "err-suggestion-not-found",
                  name: "SuggestionNotFoundError",
                  code: "SUGGESTION_NOT_FOUND",
                  description: "No suggestion with this id exists.",
                  template: "",
                },
                {
                  id: "err-suggestion-not-open",
                  name: "SuggestionNotOpenError",
                  code: "SUGGESTION_NOT_OPEN",
                  description: "The suggestion was already used or dismissed.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-dismiss-suggestion",
              name: "DISMISS_SUGGESTION",
              description:
                "Dismiss an open suggestion; it is never offered again.",
              schema: "input DismissSuggestionInput {\n  id: OID!\n}",
              template:
                "Dismiss an open suggestion; it is never offered again.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-iterate",
          name: "iterate",
          description:
            "Variants, remix and compose origins, review findings, notes and public source.",
          operations: [
            {
              id: "op-set-review-suggestions",
              name: "SET_REVIEW_SUGGESTIONS",
              description:
                "Store the agent's review findings (0\u20133) for a version. Replaces the open findings for that version; ideas and used or dismissed findings are kept.",
              schema:
                "input SetReviewSuggestionsItemInput {\n  id: OID!\n  text: String!\n  screenshot: String\n}\n\ninput SetReviewSuggestionsInput {\n  afterVersion: Int!\n  items: [SetReviewSuggestionsItemInput!]!\n}",
              template:
                "Store the agent's review findings (0\u20133) for a version. Replaces the open findings for that version; ideas and used or dismissed findings are kept.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-review-count",
                  name: "InvalidReviewCountError",
                  code: "INVALID_REVIEW_COUNT",
                  description: "Review findings come in sets of 0 to 3.",
                  template: "",
                },
                {
                  id: "err-invalid-review-text",
                  name: "InvalidReviewTextError",
                  code: "INVALID_REVIEW_TEXT",
                  description:
                    "A finding's text is empty or longer than 80 characters.",
                  template: "",
                },
                {
                  id: "err-duplicate-review-id",
                  name: "DuplicateReviewIdError",
                  code: "DUPLICATE_REVIEW_ID",
                  description: "A suggestion with this id already exists.",
                  template: "",
                },
                {
                  id: "err-unknown-version",
                  name: "UnknownVersionError",
                  code: "UNKNOWN_VERSION",
                  description: "No version with this number exists.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-start-variants",
              name: "START_VARIANTS",
              description:
                "Start building two variants (A and B) of a change, each on its own branch.",
              schema:
                "input StartVariantsInput {\n  changeId: OID!\n  branchA: String!\n  branchB: String!\n}",
              template:
                "Start building two variants (A and B) of a change, each on its own branch.",
              reducer: "",
              errors: [
                {
                  id: "err-variant-change-not-found",
                  name: "VariantChangeNotFoundError",
                  code: "VARIANT_CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-variants-exist",
                  name: "VariantsExistError",
                  code: "VARIANTS_EXIST",
                  description:
                    "The change already has variants that were not discarded.",
                  template: "",
                },
                {
                  id: "err-change-not-open",
                  name: "ChangeNotOpenError",
                  code: "CHANGE_NOT_OPEN",
                  description:
                    "Variants start only while the change is building or ready.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-variant-status",
              name: "SET_VARIANT_STATUS",
              description:
                "Record that a variant finished building (READY) or failed (FAILED).",
              schema:
                "input SetVariantStatusInput {\n  changeId: OID!\n  label: VariantLabel!\n  status: VariantStatus!\n  chatSessionId: PHID\n  summary: String\n}",
              template:
                "Record that a variant finished building (READY) or failed (FAILED).",
              reducer: "",
              errors: [
                {
                  id: "err-variant-change-not-found",
                  name: "VariantChangeNotFoundError",
                  code: "VARIANT_CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-variant-not-found",
                  name: "VariantNotFoundError",
                  code: "VARIANT_NOT_FOUND",
                  description: "The change has no variant with this label.",
                  template: "",
                },
                {
                  id: "err-invalid-variant-transition",
                  name: "InvalidVariantTransitionError",
                  code: "INVALID_VARIANT_TRANSITION",
                  description:
                    "A variant only moves from BUILDING to READY or FAILED.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-keep-variant",
              name: "KEEP_VARIANT",
              description:
                "Keep one ready variant as the change and discard the other.",
              schema:
                "input KeepVariantInput {\n  changeId: OID!\n  label: VariantLabel!\n}",
              template:
                "Keep one ready variant as the change and discard the other.",
              reducer: "",
              errors: [
                {
                  id: "err-variant-change-not-found",
                  name: "VariantChangeNotFoundError",
                  code: "VARIANT_CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-variant-not-found",
                  name: "VariantNotFoundError",
                  code: "VARIANT_NOT_FOUND",
                  description: "The change has no variant with this label.",
                  template: "",
                },
                {
                  id: "err-variant-not-ready",
                  name: "VariantNotReadyError",
                  code: "VARIANT_NOT_READY",
                  description: "Only a ready variant can be kept.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-origin",
              name: "SET_ORIGIN",
              description:
                "Record a published package this product was remixed from or composes. Replaces the entry with the same package name.",
              schema:
                "input SetOriginInput {\n  packageName: String!\n  version: String!\n  mode: OriginMode!\n  license: String!\n  sourceUrl: URL\n  sourceRef: String\n  missing: [String!]!\n  at: DateTime!\n}",
              template:
                "Record a published package this product was remixed from or composes. Replaces the entry with the same package name.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-origin",
                  name: "InvalidOriginError",
                  code: "INVALID_ORIGIN",
                  description: "An origin needs a package name and a version.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-upstream-version",
              name: "SET_UPSTREAM_VERSION",
              description:
                "Record the latest published version of an origin's package.",
              schema:
                "input SetUpstreamVersionInput {\n  packageName: String!\n  latestVersion: String!\n  checkedAt: DateTime!\n}",
              template:
                "Record the latest published version of an origin's package.",
              reducer: "",
              errors: [
                {
                  id: "err-origin-not-found",
                  name: "OriginNotFoundError",
                  code: "ORIGIN_NOT_FOUND",
                  description: "No origin with this package name exists.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-notes-enabled",
              name: "SET_NOTES_ENABLED",
              description:
                "Turn notes from people using the live product on or off.",
              schema:
                "input SetNotesEnabledInput {\n  enabled: Boolean!\n  at: DateTime!\n}",
              template:
                "Turn notes from people using the live product on or off.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-accept-source-notice",
              name: "ACCEPT_SOURCE_NOTICE",
              description:
                "Record that the owner accepted the notice about publishing the product's source.",
              schema: "input AcceptSourceNoticeInput {\n  at: DateTime!\n}",
              template:
                "Record that the owner accepted the notice about publishing the product's source.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-public-source",
              name: "SET_PUBLIC_SOURCE",
              description: "Record where the product's source is published.",
              schema:
                "input SetPublicSourceInput {\n  kind: PublicSourceKind!\n  url: URL!\n  version: Int!\n}",
              template: "Record where the product's source is published.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-public-source",
                  name: "InvalidPublicSourceError",
                  code: "INVALID_PUBLIC_SOURCE",
                  description: "A public source version is 1 or more.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-workshop",
          name: "workshop",
          description:
            "The workshop flow: the understanding, explainers, the guided loop, room questions, change cost and row imports.",
          operations: [
            {
              id: "op-set-understood",
              name: "SET_UNDERSTOOD",
              description:
                "Store what the agent understood from the idea and the materials (replaces the previous understanding).",
              schema:
                "input SetUnderstoodMaterialInput {\n  id: OID!\n  name: String!\n  kind: MaterialKind!\n}\n\ninput SetUnderstoodInput {\n  json: String!\n  language: String!\n  at: DateTime!\n  materials: [SetUnderstoodMaterialInput!]!\n}",
              template:
                "Store what the agent understood from the idea and the materials (replaces the previous understanding).",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-understood",
                  name: "InvalidUnderstoodError",
                  code: "INVALID_UNDERSTOOD",
                  description:
                    "The understanding is not a JSON object or is longer than 200 000 characters.",
                  template: "",
                },
                {
                  id: "err-invalid-language",
                  name: "InvalidLanguageError",
                  code: "INVALID_LANGUAGE",
                  description: 'The language is not "de" or "en".',
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-mark-explainers-seen",
              name: "MARK_EXPLAINERS_SEEN",
              description:
                "Remember explainers the owner has seen; unseen ids are added in order, known ones ignored.",
              schema: "input MarkExplainersSeenInput {\n  ids: [String!]!\n}",
              template:
                "Remember explainers the owner has seen; unseen ids are added in order, known ones ignored.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-guided-loop",
              name: "SET_GUIDED_LOOP",
              description:
                "Move the guided first loop forward (NOT_STARTED, POINTED, CHANGED, WENT_BACK, DONE; skipping ahead is allowed) or dismiss it while it is not done.",
              schema:
                "input SetGuidedLoopInput {\n  status: GuidedLoopStatus!\n  at: DateTime!\n}",
              template:
                "Move the guided first loop forward (NOT_STARTED, POINTED, CHANGED, WENT_BACK, DONE; skipping ahead is allowed) or dismiss it while it is not done.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-guided-loop-transition",
                  name: "InvalidGuidedLoopTransitionError",
                  code: "INVALID_GUIDED_LOOP_TRANSITION",
                  description:
                    "The guided loop only moves forward, and can be dismissed only while it is not done or dismissed.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-ask-question",
              name: "ASK_QUESTION",
              description:
                "The agent asks the room a question about a change, with up to 4 options and a default answer.",
              schema:
                "input AskQuestionInput {\n  changeId: OID!\n  id: OID!\n  text: String!\n  options: [String!]!\n  defaultAnswer: String!\n  language: String!\n  askedAt: DateTime!\n}",
              template:
                "The agent asks the room a question about a change, with up to 4 options and a default answer.",
              reducer: "",
              errors: [
                {
                  id: "err-question-change-not-found",
                  name: "QuestionChangeNotFoundError",
                  code: "QUESTION_CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-duplicate-question-id",
                  name: "DuplicateQuestionIdError",
                  code: "DUPLICATE_QUESTION_ID",
                  description:
                    "The change already has a question with this id.",
                  template: "",
                },
                {
                  id: "err-invalid-question",
                  name: "InvalidQuestionError",
                  code: "INVALID_QUESTION",
                  description:
                    'The question text is empty or longer than 200 characters, it has more than 4 options, its default answer is empty, or its language is not "de" or "en".',
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-answer-question",
              name: "ANSWER_QUESTION",
              description:
                "Record the answer to a question, given by the room or by its default.",
              schema:
                "input AnswerQuestionInput {\n  changeId: OID!\n  id: OID!\n  answer: String!\n  answeredBy: QuestionAnswerBy!\n  answeredAt: DateTime!\n}",
              template:
                "Record the answer to a question, given by the room or by its default.",
              reducer: "",
              errors: [
                {
                  id: "err-question-not-found",
                  name: "QuestionNotFoundError",
                  code: "QUESTION_NOT_FOUND",
                  description: "No question with this id exists on the change.",
                  template: "",
                },
                {
                  id: "err-question-already-answered",
                  name: "QuestionAlreadyAnsweredError",
                  code: "QUESTION_ALREADY_ANSWERED",
                  description: "The question was already answered.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-change-cost",
              name: "SET_CHANGE_COST",
              description:
                "Record the model-usage meter (US dollars) at a change's start and/or end; only the given side(s) are set.",
              schema:
                "input SetChangeCostInput {\n  changeId: OID!\n  startUsd: Float\n  endUsd: Float\n}",
              template:
                "Record the model-usage meter (US dollars) at a change's start and/or end; only the given side(s) are set.",
              reducer: "",
              errors: [
                {
                  id: "err-cost-change-not-found",
                  name: "CostChangeNotFoundError",
                  code: "COST_CHANGE_NOT_FOUND",
                  description: "No change with this id exists.",
                  template: "",
                },
                {
                  id: "err-invalid-cost",
                  name: "InvalidCostError",
                  code: "INVALID_COST",
                  description: "A cost is negative.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-start-row-import",
              name: "START_ROW_IMPORT",
              description:
                "The owner confirmed importing the rows of a sheet as documents of a type.",
              schema:
                "input StartRowImportInput {\n  id: OID!\n  materialId: OID!\n  sheet: String!\n  documentType: String!\n  rows: Int!\n  at: DateTime!\n}",
              template:
                "The owner confirmed importing the rows of a sheet as documents of a type.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-row-import",
                  name: "DuplicateRowImportError",
                  code: "DUPLICATE_ROW_IMPORT",
                  description: "A row import with this id already exists.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-finish-row-import",
              name: "FINISH_ROW_IMPORT",
              description:
                "A row import finished: how many rows were imported and whether it is done or failed.",
              schema:
                "input FinishRowImportInput {\n  id: OID!\n  imported: Int!\n  status: RowImportStatus!\n  failure: String\n  at: DateTime!\n}",
              template:
                "A row import finished: how many rows were imported and whether it is done or failed.",
              reducer: "",
              errors: [
                {
                  id: "err-row-import-not-found",
                  name: "RowImportNotFoundError",
                  code: "ROW_IMPORT_NOT_FOUND",
                  description: "No row import with this id exists.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
    },
  ],
};
