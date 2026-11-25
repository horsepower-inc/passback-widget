import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'pbc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const save = (extra: Record<string, unknown>) =>
  SaveIntegration.safeParse({ tracker: 'gitlab', credential, project: 'group/project', ...extra });

describe('GitLab requests', () => {
  it('accepts a GitLab verify request with a token and no address', () => {
    expect(VerifyRequest.safeParse({ tracker: 'gitlab', credential }).success).toBe(true);
  });

  it('accepts a GitLab verify and save with a self-managed https address', () => {
    const gitlabUrl = 'https://gitlab.example.com';
    expect(VerifyRequest.safeParse({ tracker: 'gitlab', credential, gitlabUrl }).success).toBe(
      true,
    );
    expect(save({ gitlabUrl }).success).toBe(true);
  });

  it('refuses a GitLab address that is http, has a path or names a private host', () => {
    for (const gitlabUrl of [
      'http://gitlab.example.com',
      'https://gitlab.example.com/sub/path',
      'https://localhost',
      'https://gitlab.internal',
    ]) {
      expect(VerifyRequest.safeParse({ tracker: 'gitlab', credential, gitlabUrl }).success).toBe(
        false,
      );
      expect(save({ gitlabUrl }).success).toBe(false);
    }
  });

  it('accepts a numeric project id and a nested group path and refuses a project with spaces or a leading slash', () => {
    expect(save({ project: '12345' }).success).toBe(true);
    expect(save({ project: 'group/sub/project' }).success).toBe(true);
    expect(save({ project: 'my group/project' }).success).toBe(false);
    expect(save({ project: '/group/project' }).success).toBe(false);
    expect(save({ project: 'group/' }).success).toBe(false);
    expect(save({ project: 'group' }).success).toBe(false);
    expect(save({ project: `g/${'a'.repeat(260)}` }).success).toBe(false);
  });

  it('refuses a GitLab save without a project or with an unknown field', () => {
    expect(SaveIntegration.safeParse({ tracker: 'gitlab', credential }).success).toBe(false);
    expect(save({ extra: 1 }).success).toBe(false);
  });

  it('names gitlab in the tracker list and keeps the other four', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining(['linear', 'plane', 'github', 'jira', 'gitlab']),
    );
  });
});
