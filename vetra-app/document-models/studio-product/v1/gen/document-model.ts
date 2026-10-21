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
            "# Studio Product: the single read model the Studio page renders from.\n# Natural keys (F54): ProductStep, CheckResult and LaunchLine are keyed by\n# their `kind`, Version by `number`, PackageVersion by `name`; reducers keep\n# them unique within their list.\n\nenum StepKind {\n  PLAN\n  DATA\n  EDITORS\n  TESTS\n  LIVE\n}\n\nenum StepStatus {\n  NOT_STARTED\n  WORKING\n  DONE\n  NEEDS_YOU\n  STOPPED\n  LIVE\n}\n\nenum ChangeKind {\n  FIRST_BUILD\n  CHANGE\n  UNDO\n  BEFORE_VERSIONS\n}\n\nenum ChangeStatus {\n  BUILDING\n  PAUSED\n  READY\n  LAUNCHING\n  LAUNCHED\n  DISCARDED\n  FAILED\n  CLOSED\n}\n\nenum CheckKind {\n  GENERATE\n  TYPECHECK\n  LINT\n  REDUCER_TESTS\n  SMOKE\n}\n\nenum ProductAccess {\n  SIGNED_IN\n  OWNER_ONLY\n}\n\nenum LiveHealth {\n  UNKNOWN\n  HEALTHY\n  UNHEALTHY\n}\n\nenum PermissionState {\n  UNKNOWN\n  GRANTED\n  MISSING\n  EXPIRED\n}\n\nenum RequestKind {\n  LAUNCH\n  ROLLBACK\n  DISCARD\n  RESTART\n  MIRROR\n}\n\nenum VersionStatus {\n  LAUNCHING\n  LIVE\n  PREVIOUS\n  FAILED\n}\n\nenum LaunchLineKind {\n  SNAPSHOT\n  PUBLISH\n  DEPLOY\n  VERIFY\n  MIRROR\n}\n\nenum LineStatus {\n  WAITING\n  RUNNING\n  DONE\n  FAILED\n  SKIPPED\n}\n\nenum SuggestionStatus {\n  OPEN\n  USED\n  DISMISSED\n}\n\nenum GithubStatus {\n  NOT_CONNECTED\n  CONNECTED\n  DISCONNECTED\n  PUSH_FAILED\n}\n\ntype ProductStep {\n  kind: StepKind!\n  status: StepStatus!\n  done: Int\n  total: Int\n  label: String\n  reason: String\n  updatedAt: DateTime\n}\n\ntype Milestone {\n  id: OID!\n  text: String!\n  at: DateTime!\n  recovered: Boolean!\n}\n\ntype CheckResult {\n  kind: CheckKind!\n  passed: Boolean!\n  reason: String\n}\n\ntype CheckRun {\n  id: OID!\n  at: DateTime!\n  results: [CheckResult!]!\n}\n\ntype Stuck {\n  reason: String!\n  tried: [String!]!\n  at: DateTime!\n}\n\ntype ChangeMetrics {\n  steps: Int!\n  firstPreviewAt: DateTime\n  readyAt: DateTime\n  liveAt: DateTime\n}\n\ntype Change {\n  id: OID!\n  kind: ChangeKind!\n  request: String!\n  title: String\n  chatSessionId: PHID\n  chatSessionIds: [PHID!]!\n  status: ChangeStatus!\n  startedAt: DateTime!\n  steps: [ProductStep!]!\n  milestones: [Milestone!]!\n  checkRuns: [CheckRun!]!\n  stuck: Stuck\n  metrics: ChangeMetrics!\n  lintWaivedAt: DateTime\n}\n\ntype PackageVersion {\n  name: String!\n  version: String!\n}\n\ntype LaunchLine {\n  kind: LaunchLineKind!\n  status: LineStatus!\n  detail: String\n}\n\ntype Version {\n  number: Int!\n  title: String!\n  summary: String\n  changeId: OID\n  gitTag: String!\n  sha: String!\n  packages: [PackageVersion!]!\n  deploymentId: String\n  launchedAt: DateTime\n  launchedBy: String!\n  trigger: String!\n  status: VersionStatus!\n  lines: [LaunchLine!]!\n  changedFiles: [String!]!\n  failure: String\n  rollbackBlockedReason: String\n}\n\ntype PendingRequest {\n  kind: RequestKind!\n  changeId: OID\n  targetVersion: Int\n  requestedAt: DateTime!\n  requestedBy: String!\n}\n\ntype Suggestion {\n  id: OID!\n  text: String!\n  afterVersion: Int!\n  status: SuggestionStatus!\n}\n\ntype GithubLink {\n  status: GithubStatus!\n  repoFullName: String\n  lastError: String\n  externalChangesSha: String\n}\n\ntype StudioProductState {\n  name: String\n  idea: String\n  slug: String\n  liveUrl: URL\n  appId: String\n  productionEnvironmentId: String\n  productDriveId: PHID\n  createdAt: DateTime\n  access: ProductAccess!\n  changes: [Change!]!\n  activeChangeId: OID\n  liveVersion: Int\n  versions: [Version!]!\n  health: LiveHealth!\n  pendingRequest: PendingRequest\n  launchPermission: PermissionState!\n  suggestions: [Suggestion!]!\n  github: GithubLink!\n}\n",
          initialValue:
            '{\n  "name": null,\n  "idea": null,\n  "slug": null,\n  "liveUrl": null,\n  "appId": null,\n  "productionEnvironmentId": null,\n  "productDriveId": null,\n  "createdAt": null,\n  "access": "SIGNED_IN",\n  "changes": [],\n  "activeChangeId": null,\n  "liveVersion": null,\n  "versions": [],\n  "health": "UNKNOWN",\n  "pendingRequest": null,\n  "launchPermission": "UNKNOWN",\n  "suggestions": [],\n  "github": {\n    "status": "NOT_CONNECTED",\n    "repoFullName": null,\n    "lastError": null,\n    "externalChangesSha": null\n  }\n}',
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
              description: "Add a story line to a change. Clears stuck.",
              schema:
                "input AddMilestoneInput {\n  changeId: OID!\n  id: OID!\n  text: String!\n  recovered: Boolean\n  at: DateTime!\n}",
              template: "Add a story line to a change. Clears stuck.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-milestone-id",
                  name: "DuplicateMilestoneIdError",
                  code: "DUPLICATE_MILESTONE_ID",
                  description: "A milestone with this id already exists.",
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
          ],
        },
      ],
    },
  ],
};
