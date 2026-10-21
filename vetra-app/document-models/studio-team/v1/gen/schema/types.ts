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

export type AddReviewerInput = {
  address: Scalars["EthereumAddress"]["input"];
  at: Scalars["DateTime"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
};

export type ClearMemberLimitInput = {
  address: Scalars["EthereumAddress"]["input"];
};

export type ClearRoleOverrideInput = {
  address: Scalars["EthereumAddress"]["input"];
};

export type Guest = {
  address: Scalars["EthereumAddress"]["output"];
  changeId: Scalars["OID"]["output"];
  expiresAt: Scalars["DateTime"]["output"];
  id: Scalars["OID"]["output"];
  invitedAt: Scalars["DateTime"]["output"];
  name: Maybe<Scalars["String"]["output"]>;
  revokedAt: Maybe<Scalars["DateTime"]["output"]>;
  rights: GuestRights;
};

export type GuestRights = "COMMENT" | "COMMENT_STEER";

export type InitTeamInput = {
  at: Scalars["DateTime"]["input"];
  orgId: Scalars["String"]["input"];
  reviewRequired: Scalars["Boolean"]["input"];
};

export type InviteGuestInput = {
  address: Scalars["EthereumAddress"]["input"];
  changeId: Scalars["OID"]["input"];
  expiresAt: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
  invitedAt: Scalars["DateTime"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
  rights: GuestRights;
};

export type MemberLimit = {
  address: Scalars["EthereumAddress"]["output"];
  at: Scalars["DateTime"]["output"];
  monthlyUsd: Scalars["Float"]["output"];
};

export type RemoveReviewerInput = {
  address: Scalars["EthereumAddress"]["input"];
};

export type RevokeGuestInput = {
  at: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
};

export type RoleOverride = {
  address: Scalars["EthereumAddress"]["output"];
  at: Scalars["DateTime"]["output"];
  role: StudioRole;
};

export type SetMemberLimitInput = {
  address: Scalars["EthereumAddress"]["input"];
  at: Scalars["DateTime"]["input"];
  monthlyUsd: Scalars["Float"]["input"];
};

export type SetReviewRequiredInput = {
  at: Scalars["DateTime"]["input"];
  required: Scalars["Boolean"]["input"];
};

export type SetRoleOverrideInput = {
  address: Scalars["EthereumAddress"]["input"];
  at: Scalars["DateTime"]["input"];
  role: StudioRole;
};

export type StudioRole = "MAKER" | "OWNER" | "VIEWER";

export type StudioTeamState = {
  guests: Array<Guest>;
  memberLimits: Array<MemberLimit>;
  orgId: Maybe<Scalars["String"]["output"]>;
  reviewRequired: Scalars["Boolean"]["output"];
  reviewers: Array<TeamPerson>;
  roleOverrides: Array<RoleOverride>;
};

export type TeamPerson = {
  addedAt: Scalars["DateTime"]["output"];
  address: Scalars["EthereumAddress"]["output"];
  name: Maybe<Scalars["String"]["output"]>;
};
