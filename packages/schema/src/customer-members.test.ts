import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CustomerErrorCode, MeView } from './customer';
import {
  AcceptInvite,
  InviteMember,
  InviteView,
  MemberView,
  UpdateMyData,
} from './customer-members';

const at = '2026-10-14T10:00:00Z';
const me = {
  user: { id: 'u1', email: 'a@b.io' },
  org: { id: 'o1', name: 'Acme' },
  csrf: 'c',
};

describe('customer members', () => {
  it('parses a member view with a role and refuses an unknown role', () => {
    const member = { userId: 'u1', email: 'a@b.io', role: 'owner', joinedAt: at };
    expect(MemberView.safeParse(member).success).toBe(true);
    expect(MemberView.safeParse({ ...member, name: 'Ann', role: 'member' }).success).toBe(true);
    expect(MemberView.safeParse({ ...member, role: 'admin' }).success).toBe(false);
    expect(MemberView.safeParse({ ...member, role: undefined }).success).toBe(false);
  });

  it('keeps the token and its digest out of the invite view', () => {
    const invite = { id: 'i1', email: 'a@b.io', createdAt: at, expiresAt: at };
    expect(InviteView.safeParse(invite).success).toBe(true);
    expect(InviteView.safeParse({ ...invite, token: 'x' }).success).toBe(false);
    expect(InviteView.safeParse({ ...invite, tokenDigest: 'x' }).success).toBe(false);
  });

  it('lower-cases and trims an invited address and refuses a malformed one', () => {
    expect(InviteMember.parse({ email: '  Ann@Example.COM ' })).toEqual({
      email: 'ann@example.com',
    });
    expect(InviteMember.safeParse({ email: 'not-an-address' }).success).toBe(false);
    expect(InviteMember.safeParse({ email: `${'a'.repeat(250)}@b.io` }).success).toBe(false);
  });

  it('accepts a token of the invite pattern and refuses any other', () => {
    const token = `pbi_${'A1_-'.repeat(11).slice(0, 43)}`;
    expect(AcceptInvite.safeParse({ token }).success).toBe(true);
    expect(AcceptInvite.safeParse({ token: token.slice(0, -1) }).success).toBe(false);
    expect(AcceptInvite.safeParse({ token: `${token}A` }).success).toBe(false);
    expect(AcceptInvite.safeParse({ token: `pbx_${token.slice(4)}` }).success).toBe(false);
    expect(AcceptInvite.safeParse({ token: `pbi_${'!'.repeat(43)}` }).success).toBe(false);
  });

  it('refuses a blank or over-long name in the my-data body', () => {
    expect(UpdateMyData.parse({ name: ' Ann ' })).toEqual({ name: 'Ann' });
    expect(UpdateMyData.safeParse({ name: '   ' }).success).toBe(false);
    expect(UpdateMyData.safeParse({ name: 'a'.repeat(81) }).success).toBe(false);
    expect(UpdateMyData.safeParse({ name: 'a'.repeat(80) }).success).toBe(true);
  });

  it('parses MeView with and without a role', () => {
    expect(MeView.safeParse(me).success).toBe(true);
    expect(MeView.safeParse({ ...me, role: 'member' }).success).toBe(true);
    expect(MeView.safeParse({ ...me, role: 'admin' }).success).toBe(false);
  });

  it('names the member error codes after tracker_changed, then the four account delete codes last', () => {
    const values = CustomerErrorCode.options;
    const from = values.indexOf('tracker_changed');
    expect(values.slice(from + 1)).toEqual([
      'forbidden',
      'already_in_account',
      'invite_invalid',
      'member_limit',
      'cannot_remove_owner',
      'email_failed',
      'refund_window_closed',
      'confirmation_mismatch',
      'storage_failed',
      'billing_unavailable',
      'unavailable',
    ]);
  });

  it('an invited address round-trips through the schema in lower case', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const once = InviteMember.safeParse({ email });
        if (!once.success) return;
        expect(once.data.email).toBe(once.data.email.toLowerCase());
        expect(InviteMember.parse({ email: once.data.email })).toEqual(once.data);
      }),
    );
  });
});
