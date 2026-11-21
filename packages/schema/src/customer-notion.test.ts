import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'ntn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const dashed = '1324a887-451a-4f5c-9b6c-0d1e2f3a4b5c';
const plain = '1324A887451A4F5C9B6C0D1E2F3A4B5C';

describe('Notion requests', () => {
  it('accepts a Notion verify request with a secret and nothing else', () => {
    expect(VerifyRequest.safeParse({ tracker: 'notion', credential }).success).toBe(true);
  });

  it('refuses a Notion verify request with an address or a workspace', () => {
    const withAddress = { tracker: 'notion', credential, planeUrl: 'https://notion.example.com' };
    const withWorkspace = { tracker: 'notion', credential, workspace: 'acme' };
    expect(VerifyRequest.safeParse(withAddress).success).toBe(false);
    expect(VerifyRequest.safeParse(withWorkspace).success).toBe(false);
  });

  it('accepts a Notion save with a dashed or a plain UUID as the data source', () => {
    for (const project of [dashed, plain]) {
      expect(SaveIntegration.safeParse({ tracker: 'notion', credential, project }).success).toBe(
        true,
      );
    }
  });

  it('refuses a Notion save without a data source, with a name instead of a UUID or with an unknown field', () => {
    expect(SaveIntegration.safeParse({ tracker: 'notion', credential }).success).toBe(false);
    expect(
      SaveIntegration.safeParse({ tracker: 'notion', credential, project: 'Bug reports' }).success,
    ).toBe(false);
    expect(
      SaveIntegration.safeParse({ tracker: 'notion', credential, project: dashed + '0' }).success,
    ).toBe(false);
    expect(
      SaveIntegration.safeParse({ tracker: 'notion', credential, project: dashed, workspace: 'a' })
        .success,
    ).toBe(false);
  });

  it('names notion in the tracker list and keeps the other four', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining(['linear', 'plane', 'github', 'jira', 'notion']),
    );
  });
});
