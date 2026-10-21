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
            "# Studio Product: the single read model the Studio page renders from.\n# Natural keys (F54): ProductStep, CheckResult and LaunchLine are keyed by\n# their `kind`, Version by `number`, PackageVersion by `name`; reducers keep\n# them unique within their list.\n\nenum StepKind {\n  PLAN\n  DATA\n  EDITORS\n  TESTS\n  LIVE\n}\n\nenum StepStatus {\n  NOT_STARTED\n  WORKING\n  DONE\n  NEEDS_YOU\n  STOPPED\n  LIVE\n}\n\nenum ChangeKind {\n  FIRST_BUILD\n  CHANGE\n  UNDO\n  BEFORE_VERSIONS\n}\n\nenum ChangeStatus {\n  BUILDING\n  PAUSED\n  READY\n  LAUNCHING\n  LAUNCHED\n  DISCARDED\n  FAILED\n  CLOSED\n}\n\nenum CheckKind {\n  GENERATE\n  TYPECHECK\n  LINT\n  REDUCER_TESTS\n  SMOKE\n}\n\nenum ProductAccess {\n  SIGNED_IN\n  OWNER_ONLY\n}\n\nenum LiveHealth {\n  UNKNOWN\n  HEALTHY\n  UNHEALTHY\n}\n\nenum PermissionState {\n  UNKNOWN\n  GRANTED\n  MISSING\n  EXPIRED\n}\n\nenum RequestKind {\n  LAUNCH\n  ROLLBACK\n  DISCARD\n  RESTART\n  MIRROR\n}\n\nenum VersionStatus {\n  LAUNCHING\n  LIVE\n  PREVIOUS\n  FAILED\n}\n\nenum LaunchLineKind {\n  SNAPSHOT\n  PUBLISH\n  DEPLOY\n  VERIFY\n  MIRROR\n}\n\nenum LineStatus {\n  WAITING\n  RUNNING\n  DONE\n  FAILED\n  SKIPPED\n}\n\nenum SuggestionStatus {\n  OPEN\n  USED\n  DISMISSED\n}\n\nenum GithubStatus {\n  NOT_CONNECTED\n  CONNECTED\n  DISCONNECTED\n  PUSH_FAILED\n}\n\ntype ProductStep {\n  kind: StepKind!\n  status: StepStatus!\n  done: Int\n  total: Int\n  label: String\n  reason: String\n  updatedAt: DateTime\n}\n\ntype Milestone {\n  id: OID!\n  text: String!\n  at: DateTime!\n  recovered: Boolean!\n}\n\ntype CheckResult {\n  kind: CheckKind!\n  passed: Boolean!\n  reason: String\n}\n\ntype CheckRun {\n  id: OID!\n  at: DateTime!\n  results: [CheckResult!]!\n}\n\ntype Stuck {\n  reason: String!\n  tried: [String!]!\n  at: DateTime!\n}\n\ntype ChangeMetrics {\n  steps: Int!\n  firstPreviewAt: DateTime\n  readyAt: DateTime\n  liveAt: DateTime\n}\n\ntype Change {\n  id: OID!\n  kind: ChangeKind!\n  request: String!\n  title: String\n  chatSessionId: PHID\n  chatSessionIds: [PHID!]!\n  status: ChangeStatus!\n  startedAt: DateTime!\n  steps: [ProductStep!]!\n  milestones: [Milestone!]!\n  checkRuns: [CheckRun!]!\n  stuck: Stuck\n  metrics: ChangeMetrics!\n  lintWaivedAt: DateTime\n}\n\ntype PackageVersion {\n  name: String!\n  version: String!\n}\n\ntype LaunchLine {\n  kind: LaunchLineKind!\n  status: LineStatus!\n  detail: String\n}\n\ntype Version {\n  number: Int!\n  title: String!\n  summary: String\n  changeId: OID\n  gitTag: String!\n  sha: String!\n  packages: [PackageVersion!]!\n  deploymentId: String\n  launchedAt: DateTime\n  launchedBy: String!\n  trigger: String!\n  status: VersionStatus!\n  lines: [LaunchLine!]!\n  changedFiles: [String!]!\n  failure: String\n  rollbackBlockedReason: String\n}\n\ntype PendingRequest {\n  kind: RequestKind!\n  changeId: OID\n  targetVersion: Int\n  requestedAt: DateTime!\n  requestedBy: String!\n}\n\ntype RequestFailure {\n  kind: RequestKind!\n  reason: String!\n  at: DateTime!\n}\n\ntype Suggestion {\n  id: OID!\n  text: String!\n  afterVersion: Int!\n  status: SuggestionStatus!\n}\n\ntype GithubLink {\n  status: GithubStatus!\n  repoFullName: String\n  lastError: String\n  externalChangesSha: String\n}\n\ntype StudioProductState {\n  name: String\n  idea: String\n  slug: String\n  liveUrl: URL\n  appId: String\n  productionEnvironmentId: String\n  productDriveId: PHID\n  createdAt: DateTime\n  access: ProductAccess!\n  changes: [Change!]!\n  activeChangeId: OID\n  liveVersion: Int\n  liveSince: DateTime\n  liveDeploymentId: String\n  versions: [Version!]!\n  health: LiveHealth!\n  pendingRequest: PendingRequest\n  lastRequestFailure: RequestFailure\n  launchPermission: PermissionState!\n  suggestions: [Suggestion!]!\n  github: GithubLink!\n}\n",
          initialValue:
            '{\n  "name": null,\n  "idea": null,\n  "slug": null,\n  "liveUrl": null,\n  "appId": null,\n  "productionEnvironmentId": null,\n  "productDriveId": null,\n  "createdAt": null,\n  "access": "SIGNED_IN",\n  "changes": [],\n  "activeChangeId": null,\n  "liveVersion": null,\n  "liveSince": null,\n  "liveDeploymentId": null,\n  "versions": [],\n  "health": "UNKNOWN",\n  "pendingRequest": null,\n  "lastRequestFailure": null,\n  "launchPermission": "UNKNOWN",\n  "suggestions": [],\n  "github": {\n    "status": "NOT_CONNECTED",\n    "repoFullName": null,\n    "lastError": null,\n    "externalChangesSha": null\n  }\n}',
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
      ],
    },
  ],
};
