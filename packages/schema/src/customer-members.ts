import { z } from 'zod';

// Members and invites of one account. A view never carries an invite token or its digest.

export const MEMBER_ROLES = ['owner', 'member'] as const;
export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

export const MAX_MEMBERS_PER_ORG = 10;

// `pbi_` and 43 base64url characters: 32 random bytes.
export const INVITE_TOKEN_PATTERN = /^pbi_[A-Za-z0-9_-]{43}$/;

export const MemberView = z.strictObject({
  userId: z.string(),
  email: z.string(),
  name: z.string().optional(),
  role: MemberRole,
  joinedAt: z.iso.datetime(),
});
export type MemberView = z.infer<typeof MemberView>;

export const InviteView = z.strictObject({
  id: z.string(),
  email: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type InviteView = z.infer<typeof InviteView>;

export const MembersView = z.strictObject({
  members: z.array(MemberView).max(MAX_MEMBERS_PER_ORG),
  invites: z.array(InviteView).max(MAX_MEMBERS_PER_ORG),
});
export type MembersView = z.infer<typeof MembersView>;

// An address is stored in lower case.
export const InviteMember = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
export type InviteMember = z.infer<typeof InviteMember>;

export const AcceptInvite = z.strictObject({
  token: z.string().regex(INVITE_TOKEN_PATTERN),
});
export type AcceptInvite = z.infer<typeof AcceptInvite>;

// Body of PATCH /v1/customer/me.
export const UpdateMyData = z.strictObject({
  name: z.string().trim().min(1).max(80),
});
export type UpdateMyData = z.infer<typeof UpdateMyData>;
