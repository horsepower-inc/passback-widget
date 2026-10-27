import { describe, expect, it } from 'vitest';
import {
  CreateSite,
  CustomerErrorCode,
  IntegrationView,
  MeView,
  PullRequestList,
  SaveIntegration,
  SiteStatsView,
  SiteView,
  TestMarkRequest,
  TestMarkResponse,
  UpdateSite,
  VerifyRequest,
  VerifyResponse,
} from './customer';

const cred = 'secret-credential';

describe('customer schemas', () => {
  it('accepts a site with a name and one bare origin', () => {
    const r = CreateSite.safeParse({ name: 'Shop', origins: ['https://shop.example.com'] });
    expect(r.success).toBe(true);
    expect(CreateSite.safeParse({ name: 'Dev', origins: ['http://localhost:5173'] }).success).toBe(
      true,
    );
  });

  it('trims the site name and refuses a blank one', () => {
    const r = CreateSite.safeParse({ name: '  Shop  ', origins: ['https://a.io'] });
    expect(r.success && r.data.name).toBe('Shop');
    expect(CreateSite.safeParse({ name: '   ', origins: ['https://a.io'] }).success).toBe(false);
  });

  it('refuses an origin with a path, another scheme or no host', () => {
    for (const o of ['https://a.io/path', 'ftp://a.io', 'https://', 'https://a.io?x=1', 'https://u:p@a.io']) {
      expect(CreateSite.safeParse({ name: 'S', origins: [o] }).success).toBe(false);
    }
  });

  it('refuses more than ten origins and an empty list', () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://s${i}.io`);
    expect(CreateSite.safeParse({ name: 'S', origins: many }).success).toBe(false);
    expect(CreateSite.safeParse({ name: 'S', origins: many.slice(0, 10) }).success).toBe(true);
    expect(CreateSite.safeParse({ name: 'S', origins: [] }).success).toBe(false);
  });

  it('refuses unknown keys on a create request', () => {
    const r = CreateSite.safeParse({ name: 'S', origins: ['https://a.io'], extra: 1 });
    expect(r.success).toBe(false);
  });

  it('refuses an update that changes nothing', () => {
    expect(UpdateSite.safeParse({}).success).toBe(false);
    expect(UpdateSite.safeParse({ name: 'New' }).success).toBe(true);
    expect(UpdateSite.safeParse({ origins: ['https://a.io'] }).success).toBe(true);
  });

  it('requires a workspace to verify a Plane credential', () => {
    expect(VerifyRequest.safeParse({ tracker: 'plane', credential: cred }).success).toBe(false);
    expect(
      VerifyRequest.safeParse({ tracker: 'plane', credential: cred, workspace: 'acme' }).success,
    ).toBe(true);
    expect(VerifyRequest.safeParse({ tracker: 'linear', credential: cred }).success).toBe(true);
  });

  it('refuses a GitHub project that is not owner/repo', () => {
    const base = { tracker: 'github', credential: cred };
    expect(SaveIntegration.safeParse({ ...base, project: 'acme' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, project: 'acme/web/x' }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, project: 'acme/web' }).success).toBe(true);
  });

  it('an integration view accepts only the literal set as its credential', () => {
    const view = {
      tracker: 'linear',
      project: 'Web',
      account: 'a@b.io',
      verifiedAt: '2026-10-01T10:00:00Z',
      credential: 'set',
    };
    expect(IntegrationView.safeParse(view).success).toBe(true);
    expect(IntegrationView.safeParse({ ...view, credential: cred }).success).toBe(false);
    const site = {
      siteId: 's1',
      name: 'Shop',
      origins: ['https://a.io'],
      snippet: '<script></script>',
      integration: view,
      createdAt: '2026-10-01T10:00:00Z',
    };
    expect(SiteView.safeParse(site).success).toBe(true);
    expect(SiteView.safeParse({ ...site, integration: null }).success).toBe(true);
  });

  it('accepts the pull request sink on a GitHub verify request, a GitHub save request and an integration view', () => {
    const gh = { tracker: 'github', credential: cred };
    expect(VerifyRequest.safeParse({ ...gh, sink: 'github-pr' }).success).toBe(true);
    expect(VerifyRequest.safeParse(gh).success).toBe(true);
    const save = { ...gh, project: 'acme/web' };
    expect(SaveIntegration.safeParse({ ...save, sink: 'github-pr' }).success).toBe(true);
    expect(SaveIntegration.safeParse(save).success).toBe(true);
    const view = {
      tracker: 'github',
      project: 'acme/web',
      account: 'octo',
      verifiedAt: '2026-10-01T10:00:00Z',
      credential: 'set',
    };
    expect(IntegrationView.safeParse({ ...view, sink: 'github-pr' }).success).toBe(true);
    expect(IntegrationView.safeParse(view).success).toBe(true);
  });

  it('refuses a sink on a Linear or Plane request', () => {
    const sink = 'github-pr';
    expect(VerifyRequest.safeParse({ tracker: 'linear', credential: cred, sink }).success).toBe(
      false,
    );
    expect(
      VerifyRequest.safeParse({ tracker: 'plane', credential: cred, workspace: 'acme', sink })
        .success,
    ).toBe(false);
    expect(
      SaveIntegration.safeParse({ tracker: 'linear', credential: cred, project: 'p1', sink })
        .success,
    ).toBe(false);
    expect(
      SaveIntegration.safeParse({
        tracker: 'plane',
        credential: cred,
        workspace: 'acme',
        project: 'p1',
        sink,
      }).success,
    ).toBe(false);
  });

  it('refuses a sink other than github-pr', () => {
    const gh = { tracker: 'github', credential: cred };
    expect(VerifyRequest.safeParse({ ...gh, sink: 'issues' }).success).toBe(false);
    expect(
      SaveIntegration.safeParse({ ...gh, project: 'acme/web', sink: 'github' }).success,
    ).toBe(false);
    expect(
      IntegrationView.safeParse({
        tracker: 'github',
        project: 'acme/web',
        account: 'octo',
        verifiedAt: '2026-10-01T10:00:00Z',
        credential: 'set',
        sink: 'pr',
      }).success,
    ).toBe(false);
  });

  it('parses the me, verify and test-mark responses', () => {
    expect(
      MeView.safeParse({
        user: { id: 'u1', email: 'a@b.io' },
        org: { id: 'o1', name: 'Org' },
        csrf: 'tok',
      }).success,
    ).toBe(true);
    expect(
      VerifyResponse.safeParse({
        account: 'a@b.io',
        targets: [{ id: 't', label: 'Team', children: [{ id: 'p', label: 'Project' }] }],
      }).success,
    ).toBe(true);
    expect(TestMarkResponse.safeParse({ ref: '', url: 'https://x.io/' }).success).toBe(true);
    expect(TestMarkResponse.safeParse({ ref: '', url: 'nope' }).success).toBe(false);
  });

  const seenView = {
    tracker: 'linear',
    project: 'Web',
    account: 'a@b.io',
    verifiedAt: '2026-10-01T10:00:00Z',
    credential: 'set',
  };
  const seenSite = {
    siteId: 's1',
    name: 'Shop',
    origins: ['https://a.io'],
    snippet: '<script></script>',
    integration: seenView,
    createdAt: '2026-10-01T10:00:00Z',
  };

  it('accepts a site view with when and where the widget last loaded, and one without', () => {
    const lastSeen = { at: '2026-10-03T14:02:00Z', origin: 'https://staging.acme.example' };
    expect(SiteView.safeParse({ ...seenSite, lastSeen }).success).toBe(true);
    expect(SiteView.safeParse(seenSite).success).toBe(true);
  });

  it('refuses a lastSeen without an origin, with a time that is not a date, or with an extra key', () => {
    const bad = [
      { at: '2026-10-03T14:02:00Z' },
      { at: 'yesterday', origin: 'https://a.io' },
      { at: '2026-10-03T14:02:00Z', origin: 'https://a.io', ip: '1.2.3.4' },
    ];
    for (const lastSeen of bad) {
      expect(SiteView.safeParse({ ...seenSite, lastSeen }).success).toBe(false);
    }
  });

  it('accepts an integration view with testedAt and refuses one that is not a date', () => {
    expect(IntegrationView.safeParse({ ...seenView, testedAt: '2026-10-03T14:05:00Z' }).success).toBe(
      true,
    );
    expect(IntegrationView.safeParse(seenView).success).toBe(true);
    expect(IntegrationView.safeParse({ ...seenView, testedAt: 'soon' }).success).toBe(false);
  });

  it('accepts one wildcard pattern in the leftmost host label', () => {
    for (const o of ['https://*-acme.vercel.app', 'https://pr-*.acme.dev', 'http://*.preview.acme.dev:8080']) {
      expect(CreateSite.safeParse({ name: 'S', origins: [o, 'https://a.io'] }).success).toBe(true);
    }
  });

  it('refuses a wildcard outside the leftmost label, a second star, no scheme, a single label after it or a path', () => {
    const bad = [
      'https://app.*.vercel.app',
      'https://*-*.acme.dev',
      '*.acme.dev',
      'https://*.dev',
      'https://*-acme.vercel.app/x',
    ];
    for (const o of bad) {
      expect(CreateSite.safeParse({ name: 'S', origins: [o] }).success).toBe(false);
    }
  });

  it('refuses a second wildcard pattern on one site', () => {
    const origins = ['https://*-a.vercel.app', 'https://*-b.vercel.app'];
    expect(CreateSite.safeParse({ name: 'S', origins }).success).toBe(false);
    expect(UpdateSite.safeParse({ origins }).success).toBe(false);
  });

  it('accepts an integration view with a target name and one without', () => {
    const view = {
      tracker: 'linear',
      project: 'a1b2',
      account: 'a@b.io',
      verifiedAt: '2026-10-01T10:00:00Z',
      credential: 'set',
    };
    expect(IntegrationView.safeParse(view).success).toBe(true);
    expect(IntegrationView.safeParse({ ...view, targetName: 'WEB · Web team' }).success).toBe(true);
  });

  it('parses a test-mark request with and without a pull request number', () => {
    expect(TestMarkRequest.safeParse({}).success).toBe(true);
    expect(TestMarkRequest.safeParse({ pullRequest: 104 }).success).toBe(true);
    for (const b of [{ pullRequest: 0 }, { pullRequest: 1.5 }, { pullRequest: '104' }, { pr: 104 }]) {
      expect(TestMarkRequest.safeParse(b).success).toBe(false);
    }
    expect(CustomerErrorCode.safeParse('pull_request_not_open').success).toBe(true);
  });

  it('parses a list of open pull requests with number, title and branch', () => {
    const pr = { number: 104, title: 'Fix the header', branch: 'fix-header' };
    expect(PullRequestList.safeParse({ pullRequests: [] }).success).toBe(true);
    expect(PullRequestList.safeParse({ pullRequests: [pr] }).success).toBe(true);
    expect(PullRequestList.safeParse({ pullRequests: [{ ...pr, number: 0 }] }).success).toBe(false);
    expect(
      PullRequestList.safeParse({ pullRequests: [{ number: 1, title: 't' }] }).success,
    ).toBe(false);
    expect(
      PullRequestList.safeParse({ pullRequests: [{ ...pr, url: 'https://x.io' }] }).success,
    ).toBe(false);
    expect(PullRequestList.safeParse({ pullRequests: Array(101).fill(pr) }).success).toBe(false);
  });

  const statsDays =(n: number) =>
    Array.from({ length: n }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, '0')}`,
      comments: i,
    }));
  const stats = { month: '2026-10', comments: 91, included: 500, filed: 80, failed: 2 };

  it('parses a site stats view with 14 days', () => {
    const r = SiteStatsView.safeParse({ ...stats, days: statsDays(14) });
    expect(r.success).toBe(true);
  });

  it('refuses a stats view with 13 days, a negative count or an unknown key', () => {
    expect(SiteStatsView.safeParse({ ...stats, days: statsDays(13) }).success).toBe(false);
    expect(SiteStatsView.safeParse({ ...stats, failed: -1, days: statsDays(14) }).success).toBe(
      false,
    );
    expect(SiteStatsView.safeParse({ ...stats, fixed: 3, days: statsDays(14) }).success).toBe(
      false,
    );
  });
});
