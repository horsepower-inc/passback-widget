import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'pbc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const cloudId = '1324a887-451a-4f5c-9b6c-0d1e2f3a4b5c';

describe('Jira requests', () => {
  it('accepts a Jira verify request with only a credential', () => {
    expect(VerifyRequest.safeParse({ tracker: 'jira', credential }).success).toBe(true);
  });

  it('accepts a Jira save with a cloud id and a project key', () => {
    const parsed = SaveIntegration.safeParse({
      tracker: 'jira',
      credential,
      cloudId,
      project: 'PB_2',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a Jira save without a cloud id, with a lower-case key or with an unknown field', () => {
    const base = { tracker: 'jira', credential, cloudId, project: 'PB' };
    expect(SaveIntegration.safeParse({ tracker: 'jira', credential, project: 'PB' }).success).toBe(
      false,
    );
    expect(SaveIntegration.safeParse({ ...base, project: 'pb' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, cloudId: 'not-a-uuid' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(VerifyRequest.safeParse({ tracker: 'jira', credential, cloudId }).success).toBe(false);
  });

  it('names jira in the tracker list', () => {
    expect(CUSTOMER_TRACKERS).toContain('jira');
  });
});
