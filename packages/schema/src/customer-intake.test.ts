import { describe, expect, it } from 'vitest';
import { CustomerErrorCode, SaveIntegration, VerifyTarget } from './customer';

describe('intake', () => {
  it('accepts an intake flag on a Plane save and refuses it on Linear and GitHub saves', () => {
    const plane = { tracker: 'plane', credential: 'plane_key', workspace: 'acme', project: 'P1' };
    expect(SaveIntegration.safeParse({ ...plane, intake: true }).success).toBe(true);
    expect(SaveIntegration.safeParse({ ...plane, intake: false }).success).toBe(true);
    expect(SaveIntegration.safeParse(plane).success).toBe(true);
    expect(SaveIntegration.safeParse({ ...plane, intake: 'yes' }).success).toBe(false);
    const linear = { tracker: 'linear', credential: 'lin_api_key', project: 'WEB' };
    expect(SaveIntegration.safeParse({ ...linear, intake: true }).success).toBe(false);
    const github = { tracker: 'github', credential: 'github_key_x', project: 'acme/web' };
    expect(SaveIntegration.safeParse({ ...github, intake: true }).success).toBe(false);
  });

  it('lists intake_not_enabled among the customer error codes', () => {
    expect(CustomerErrorCode.options).toContain('intake_not_enabled');
  });

  it('keeps intakeEnabled optional on a verify target', () => {
    expect(VerifyTarget.safeParse({ id: 'P1', label: 'Storefront' }).success).toBe(true);
    expect(
      VerifyTarget.safeParse({ id: 'P1', label: 'Storefront', intakeEnabled: true }).success,
    ).toBe(true);
    expect(
      VerifyTarget.safeParse({ id: 'P1', label: 'Storefront', intakeEnabled: 'on' }).success,
    ).toBe(false);
  });
});
