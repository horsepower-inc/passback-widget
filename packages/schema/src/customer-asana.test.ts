import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'asana-token-123';

describe('asana integration requests', () => {
  it('accepts an Asana verify request with only a credential', () => {
    expect(VerifyRequest.safeParse({ tracker: 'asana', credential }).success).toBe(true);
  });

  it('accepts an Asana save with a workspace gid and a project gid', () => {
    const parsed = SaveIntegration.safeParse({
      tracker: 'asana',
      credential,
      workspace: '1200000000000001',
      project: '1200000000000002',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses an Asana save without a workspace, with a gid that is not digits or with an unknown field', () => {
    const ok = { tracker: 'asana', credential, workspace: '12', project: '34' };
    const withoutWorkspace = { tracker: 'asana', credential, project: '34' };
    expect(SaveIntegration.safeParse(withoutWorkspace).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, workspace: '12a' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, project: '' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, project: '1'.repeat(33) }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...ok, extra: 'x' }).success).toBe(false);
  });

  it('refuses an Asana verify request that names a workspace', () => {
    expect(VerifyRequest.safeParse({ tracker: 'asana', credential, workspace: '12' }).success).toBe(
      false,
    );
  });

  it('names asana in the tracker list and keeps the other four', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining(['linear', 'plane', 'github', 'jira', 'asana']),
    );
  });
});
