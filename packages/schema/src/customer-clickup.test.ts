import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'pk_fake_clickup';

describe('clickup integration requests', () => {
  it('accepts a ClickUp verify request with a token only', () => {
    expect(VerifyRequest.safeParse({ tracker: 'clickup', credential }).success).toBe(true);
  });

  it('refuses a ClickUp verify request with an address, a workspace or any other field', () => {
    const base = { tracker: 'clickup', credential };
    expect(VerifyRequest.safeParse({ ...base, planeUrl: 'https://api.clickup.com' }).success).toBe(
      false,
    );
    expect(VerifyRequest.safeParse({ ...base, workspace: '12' }).success).toBe(false);
    expect(VerifyRequest.safeParse({ ...base, extra: 'x' }).success).toBe(false);
  });

  it('accepts a ClickUp save with a numeric list id', () => {
    const parsed = SaveIntegration.safeParse({
      tracker: 'clickup',
      credential,
      project: '901100000001',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a ClickUp save without a list, with a non-numeric list or with an unknown field', () => {
    const ok = { tracker: 'clickup', credential, project: '901100000001' };
    expect(SaveIntegration.safeParse({ tracker: 'clickup', credential }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, project: '12a' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, project: '' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, project: '1'.repeat(21) }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, workspace: '12' }).success).toBe(false);
  });

  it('names clickup in the tracker list and keeps the other four', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining(['linear', 'plane', 'github', 'jira', 'clickup']),
    );
  });
});
