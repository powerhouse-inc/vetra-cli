import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "vetra/studio-team",
  name: "Studio Team",
  extension: "vst",
  description:
    "The Studio Team document holds one Studio's team settings: whether review is required, the reviewers, role overrides, guest invitations (each for one change, at most 30 days) and per-member monthly limits. Addresses are stored lowercase. It is a preference record, not an authority: the Studio agent resolves identity and roles itself. Readers should pass the state through normalizeTeam.",
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
            "# Studio Team: who may do what in one Studio. One document per Studio.\n# Authority never comes from this document (it is browser-writable); it holds\n# the team's preferences and the guest list the agent enforces.\nenum StudioRole {\n  OWNER\n  MAKER\n  VIEWER\n}\n\nenum GuestRights {\n  COMMENT\n  COMMENT_STEER\n}\n\ntype TeamPerson {\n  address: EthereumAddress!\n  name: String\n  addedAt: DateTime!\n}\n\ntype RoleOverride {\n  address: EthereumAddress!\n  role: StudioRole!\n  at: DateTime!\n}\n\ntype Guest {\n  id: OID!\n  address: EthereumAddress!\n  name: String\n  changeId: OID!\n  rights: GuestRights!\n  expiresAt: DateTime!\n  invitedAt: DateTime!\n  revokedAt: DateTime\n}\n\ntype MemberLimit {\n  address: EthereumAddress!\n  monthlyUsd: Float!\n  at: DateTime!\n}\n\ntype StudioTeamState {\n  orgId: String\n  reviewRequired: Boolean!\n  reviewers: [TeamPerson!]!\n  roleOverrides: [RoleOverride!]!\n  guests: [Guest!]!\n  memberLimits: [MemberLimit!]!\n}\n",
          initialValue:
            '{\n  "orgId": null,\n  "reviewRequired": false,\n  "reviewers": [],\n  "roleOverrides": [],\n  "guests": [],\n  "memberLimits": []\n}',
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
          id: "mod-team",
          name: "team",
          description: "Team settings, reviewers and role overrides.",
          operations: [
            {
              id: "op-init-team",
              name: "INIT_TEAM",
              description:
                "Initialise the team with its org, whether review is required and the time.",
              schema:
                "input InitTeamInput {\n  orgId: String!\n  reviewRequired: Boolean!\n  at: DateTime!\n}",
              template:
                "Initialise the team with its org, whether review is required and the time.",
              reducer: "",
              errors: [
                {
                  id: "err-team-already-initialized",
                  name: "TeamAlreadyInitializedError",
                  code: "TEAM_ALREADY_INITIALIZED",
                  description: "The team was already initialised.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-review-required",
              name: "SET_REVIEW_REQUIRED",
              description: "Turn the review requirement on or off.",
              schema:
                "input SetReviewRequiredInput {\n  required: Boolean!\n  at: DateTime!\n}",
              template: "Turn the review requirement on or off.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "op-add-reviewer",
              name: "ADD_REVIEWER",
              description: "Add a reviewer by address.",
              schema:
                "input AddReviewerInput {\n  address: EthereumAddress!\n  name: String\n  at: DateTime!\n}",
              template: "Add a reviewer by address.",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-reviewer",
                  name: "DuplicateReviewerError",
                  code: "DUPLICATE_REVIEWER",
                  description: "This address is already a reviewer.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-remove-reviewer",
              name: "REMOVE_REVIEWER",
              description: "Remove a reviewer.",
              schema:
                "input RemoveReviewerInput {\n  address: EthereumAddress!\n}",
              template: "Remove a reviewer.",
              reducer: "",
              errors: [
                {
                  id: "err-reviewer-not-found",
                  name: "ReviewerNotFoundError",
                  code: "REVIEWER_NOT_FOUND",
                  description: "No reviewer with this address.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-set-role-override",
              name: "SET_ROLE_OVERRIDE",
              description:
                "Set a Studio role override for an address (never OWNER).",
              schema:
                "input SetRoleOverrideInput {\n  address: EthereumAddress!\n  role: StudioRole!\n  at: DateTime!\n}",
              template:
                "Set a Studio role override for an address (never OWNER).",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-override",
                  name: "InvalidOverrideError",
                  code: "INVALID_OVERRIDE",
                  description: "OWNER cannot be granted through an override.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-clear-role-override",
              name: "CLEAR_ROLE_OVERRIDE",
              description: "Clear the role override for an address.",
              schema:
                "input ClearRoleOverrideInput {\n  address: EthereumAddress!\n}",
              template: "Clear the role override for an address.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-guests",
          name: "guests",
          description: "Guest invitations for one change.",
          operations: [
            {
              id: "op-invite-guest",
              name: "INVITE_GUEST",
              description:
                "Invite a guest to one change for a limited time (at most 30 days).",
              schema:
                "input InviteGuestInput {\n  id: OID!\n  address: EthereumAddress!\n  name: String\n  changeId: OID!\n  rights: GuestRights!\n  expiresAt: DateTime!\n  invitedAt: DateTime!\n}",
              template:
                "Invite a guest to one change for a limited time (at most 30 days).",
              reducer: "",
              errors: [
                {
                  id: "err-duplicate-guest",
                  name: "DuplicateGuestError",
                  code: "DUPLICATE_GUEST",
                  description: "A guest with this id already exists.",
                  template: "",
                },
                {
                  id: "err-invalid-guest-expiry",
                  name: "InvalidGuestExpiryError",
                  code: "INVALID_GUEST_EXPIRY",
                  description:
                    "The expiry must be after the invitation and at most 30 days later.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-revoke-guest",
              name: "REVOKE_GUEST",
              description: "Revoke a guest invitation.",
              schema:
                "input RevokeGuestInput {\n  id: OID!\n  at: DateTime!\n}",
              template: "Revoke a guest invitation.",
              reducer: "",
              errors: [
                {
                  id: "err-guest-not-found",
                  name: "GuestNotFoundError",
                  code: "GUEST_NOT_FOUND",
                  description: "No guest with this id.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "mod-limits",
          name: "limits",
          description: "Per-member monthly spend limits.",
          operations: [
            {
              id: "op-set-member-limit",
              name: "SET_MEMBER_LIMIT",
              description: "Set the monthly limit in USD for an address.",
              schema:
                "input SetMemberLimitInput {\n  address: EthereumAddress!\n  monthlyUsd: Float!\n  at: DateTime!\n}",
              template: "Set the monthly limit in USD for an address.",
              reducer: "",
              errors: [
                {
                  id: "err-invalid-limit",
                  name: "InvalidLimitError",
                  code: "INVALID_LIMIT",
                  description: "The limit cannot be negative.",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "op-clear-member-limit",
              name: "CLEAR_MEMBER_LIMIT",
              description: "Clear the monthly limit for an address.",
              schema:
                "input ClearMemberLimitInput {\n  address: EthereumAddress!\n}",
              template: "Clear the monthly limit for an address.",
              reducer: "",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
    },
  ],
};
