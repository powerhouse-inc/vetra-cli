/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddReviewerInput,
  ClearMemberLimitInput,
  ClearRoleOverrideInput,
  Guest,
  GuestRights,
  InitTeamInput,
  InviteGuestInput,
  MemberLimit,
  RemoveReviewerInput,
  RevokeGuestInput,
  RoleOverride,
  SetMemberLimitInput,
  SetReviewRequiredInput,
  SetRoleOverrideInput,
  StudioRole,
  StudioTeamState,
  TeamPerson,
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

export const GuestRightsSchema = z.enum(["COMMENT", "COMMENT_STEER"]);

export const StudioRoleSchema = z.enum(["MAKER", "OWNER", "VIEWER"]);

export function AddReviewerInputSchema(): z.ZodObject<
  Properties<AddReviewerInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    at: z.iso.datetime(),
    name: z.string().nullish(),
  });
}

export function ClearMemberLimitInputSchema(): z.ZodObject<
  Properties<ClearMemberLimitInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
  });
}

export function ClearRoleOverrideInputSchema(): z.ZodObject<
  Properties<ClearRoleOverrideInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
  });
}

export function GuestSchema(): z.ZodObject<Properties<Guest>> {
  return z.object({
    __typename: z.literal("Guest").optional(),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    changeId: z.string(),
    expiresAt: z.iso.datetime(),
    id: z.string(),
    invitedAt: z.iso.datetime(),
    name: z.string().nullish(),
    revokedAt: z.iso.datetime().nullish(),
    rights: GuestRightsSchema,
  });
}

export function InitTeamInputSchema(): z.ZodObject<Properties<InitTeamInput>> {
  return z.object({
    at: z.iso.datetime(),
    orgId: z.string(),
    reviewRequired: z.boolean(),
  });
}

export function InviteGuestInputSchema(): z.ZodObject<
  Properties<InviteGuestInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    changeId: z.string(),
    expiresAt: z.iso.datetime(),
    id: z.string(),
    invitedAt: z.iso.datetime(),
    name: z.string().nullish(),
    rights: GuestRightsSchema,
  });
}

export function MemberLimitSchema(): z.ZodObject<Properties<MemberLimit>> {
  return z.object({
    __typename: z.literal("MemberLimit").optional(),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    at: z.iso.datetime(),
    monthlyUsd: z.number(),
  });
}

export function RemoveReviewerInputSchema(): z.ZodObject<
  Properties<RemoveReviewerInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
  });
}

export function RevokeGuestInputSchema(): z.ZodObject<
  Properties<RevokeGuestInput>
> {
  return z.object({
    at: z.iso.datetime(),
    id: z.string(),
  });
}

export function RoleOverrideSchema(): z.ZodObject<Properties<RoleOverride>> {
  return z.object({
    __typename: z.literal("RoleOverride").optional(),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    at: z.iso.datetime(),
    role: StudioRoleSchema,
  });
}

export function SetMemberLimitInputSchema(): z.ZodObject<
  Properties<SetMemberLimitInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    at: z.iso.datetime(),
    monthlyUsd: z.number(),
  });
}

export function SetReviewRequiredInputSchema(): z.ZodObject<
  Properties<SetReviewRequiredInput>
> {
  return z.object({
    at: z.iso.datetime(),
    required: z.boolean(),
  });
}

export function SetRoleOverrideInputSchema(): z.ZodObject<
  Properties<SetRoleOverrideInput>
> {
  return z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    at: z.iso.datetime(),
    role: StudioRoleSchema,
  });
}

export function StudioTeamStateSchema(): z.ZodObject<
  Properties<StudioTeamState>
> {
  return z.object({
    __typename: z.literal("StudioTeamState").optional(),
    guests: z.array(z.lazy(() => GuestSchema())),
    memberLimits: z.array(z.lazy(() => MemberLimitSchema())),
    orgId: z.string().nullish(),
    reviewRequired: z.boolean(),
    reviewers: z.array(z.lazy(() => TeamPersonSchema())),
    roleOverrides: z.array(z.lazy(() => RoleOverrideSchema())),
  });
}

export function TeamPersonSchema(): z.ZodObject<Properties<TeamPerson>> {
  return z.object({
    __typename: z.literal("TeamPerson").optional(),
    addedAt: z.iso.datetime(),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
      message: "Invalid Ethereum address format",
    }),
    name: z.string().nullish(),
  });
}
