import { describe, expect, it } from 'vitest';
import { IntegrationView } from './customer';

const view = {
  tracker: 'linear',
  project: 'Web',
  account: 'a@b.io',
  verifiedAt: '2026-10-01T10:00:00Z',
  credential: 'set',
};

describe('IntegrationView filedAs', () => {
  it('accepts an integration view filed as Passback, as you or without the key, and refuses another value', () => {
    expect(IntegrationView.safeParse({ ...view, filedAs: 'passback' }).success).toBe(true);
    expect(IntegrationView.safeParse({ ...view, filedAs: 'you' }).success).toBe(true);
    expect(IntegrationView.safeParse(view).success).toBe(true);
    expect(IntegrationView.safeParse({ ...view, filedAs: 'me' }).success).toBe(false);
  });
});
