import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, IntegrationView, SaveIntegration, VerifyRequest } from './customer';

const credential = 'pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const project = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
const save = { tracker: 'azure-devops', credential, workspace: 'contoso', project };

describe('Azure DevOps requests', () => {
  it('accepts an Azure DevOps verify request with a token and an organization', () => {
    expect(
      VerifyRequest.safeParse({ tracker: 'azure-devops', credential, workspace: 'contoso' })
        .success,
    ).toBe(true);
    expect(VerifyRequest.safeParse({ tracker: 'azure-devops', credential }).success).toBe(false);
  });

  it('accepts an Azure DevOps save with an organization, a project id and Bug or Task', () => {
    expect(SaveIntegration.safeParse({ ...save, workItemType: 'Bug' }).success).toBe(true);
    expect(SaveIntegration.safeParse({ ...save, workItemType: 'Task' }).success).toBe(true);
  });

  it('accepts an Azure DevOps save without a work item type', () => {
    expect(SaveIntegration.safeParse(save).success).toBe(true);
  });

  it('refuses a work item type other than Bug or Task, a save without an organization, a project that is not an id and an unknown field', () => {
    expect(SaveIntegration.safeParse({ ...save, workItemType: 'Epic' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...save, workItemType: 'bug' }).success).toBe(false);
    expect(
      SaveIntegration.safeParse({ tracker: 'azure-devops', credential, project }).success,
    ).toBe(false);
    expect(SaveIntegration.safeParse({ ...save, project: 'Fabrikam' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...save, extra: 1 }).success).toBe(false);
  });

  it('carries the work item type on an integration view', () => {
    const view = {
      tracker: 'azure-devops',
      project,
      workspace: 'contoso',
      workItemType: 'Bug',
      account: 'Ada',
      verifiedAt: '2026-10-12T10:00:00.000Z',
      credential: 'set',
    };
    const parsed = IntegrationView.safeParse(view);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.workItemType).toBe('Bug');
    expect(IntegrationView.safeParse({ ...view, workItemType: 'Epic' }).success).toBe(false);
  });

  it('names azure-devops in the tracker list', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining(['linear', 'plane', 'github', 'jira', 'gitlab', 'azure-devops']),
    );
  });
});
