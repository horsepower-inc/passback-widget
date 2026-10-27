import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_CENTS,
  BASE_YEAR_CENTS,
  PAUSED_LINE,
  accountLine,
  addSiteCents,
  addSiteLines,
  dollars,
  runBilling,
  toBillingSummary,
  type BillingSummary,
} from './billing';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';

const TOKEN = 'pbt_secret_token_value';
const API = 'https://api.example.test';
const NOW = Date.parse('2026-10-04T12:00:00Z');
const URL_CHECKOUT = 'https://checkout.stripe.test/c/abc';
const URL_PORTAL = 'https://billing.stripe.test/p/abc';

type Reply = { status: number; body?: unknown };

function billing(over: Record<string, unknown> = {}): Reply {
  return {
    status: 200,
    body: {
      state: 'trial',
      subscribed: false,
      trialEndsAt: '2026-10-09T12:00:00Z',
      graceEndsAt: null,
      cancelAt: null,
      nextInvoiceAt: null,
      perMonthCents: 0,
      sites: 1,
      cardLast4: null,
      invoices: [],
      ...over,
    },
  };
}

function summary(over: Partial<BillingSummary> = {}): BillingSummary {
  return { state: 'trial', subscribed: false, trialEndsAt: null, perMonthCents: 0, ...over };
}

describe('billing', () => {
  let dir: string;
  let requests: { method: string; path: string; headers: Record<string, string> }[];
  let outLines: string[];
  let errLines: string[];
  let replies: Record<string, Reply>;

  function deps(): HostedDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const urlPath = String(input).slice(API.length);
        requests.push({ method, path: urlPath, headers: init?.headers as Record<string, string> });
        const reply = replies[`${method} ${urlPath}`] ?? { status: 404 };
        const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
        return new Response(text, { status: reply.status });
      }) as typeof fetch,
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pb-billing-'));
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
    requests = [];
    outLines = [];
    errLines = [];
    replies = {};
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prints the trial countdown and the Checkout link when no subscription is live', async () => {
    replies['GET /v1/customer/billing'] = billing();
    replies['POST /v1/customer/billing/checkout'] = { status: 200, body: { url: URL_CHECKOUT } };
    const code = await runBilling({ json: false, nowMs: NOW }, deps());
    expect(code).toBe(0);
    expect(outLines).toEqual(['Trial: 5 days left', `Start paying at Stripe: ${URL_CHECKOUT}`]);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /v1/customer/billing',
      'POST /v1/customer/billing/checkout',
    ]);
  });

  it('prints the Manage payment link when a subscription is live', async () => {
    replies['GET /v1/customer/billing'] = billing({
      state: 'active',
      subscribed: true,
      trialEndsAt: null,
      perMonthCents: 1550,
    });
    replies['POST /v1/customer/billing/portal'] = { status: 200, body: { url: URL_PORTAL } };
    const code = await runBilling({ json: false, nowMs: NOW }, deps());
    expect(code).toBe(0);
    expect(outLines).toEqual(['Paid: $15.50 a month', `Manage payment at Stripe: ${URL_PORTAL}`]);
  });

  it('says the account is paused', async () => {
    replies['GET /v1/customer/billing'] = billing({ state: 'paused', trialEndsAt: null });
    replies['POST /v1/customer/billing/checkout'] = { status: 200, body: { url: URL_CHECKOUT } };
    await runBilling({ json: false, nowMs: NOW }, deps());
    expect(outLines[0]).toBe(PAUSED_LINE);
    expect(PAUSED_LINE).toBe('Paused — pay to turn your sites back on');
    expect(accountLine(summary({ state: 'trial', trialEndsAt: '2026-10-04T20:00:00Z' }), NOW)).toBe(
      'Trial: 1 day left',
    );
    expect(accountLine(summary({ state: 'trial', trialEndsAt: '2026-10-01T00:00:00Z' }), NOW)).toBe(
      'Trial: ends today',
    );
    expect(accountLine(summary({ state: 'grace', subscribed: true }), NOW)).toBe(
      'Payment failed — update your card',
    );
    expect(accountLine(summary({ state: 'grace' }), NOW)).toBe('Your trial has ended');
    expect(accountLine(summary({ state: 'canceled' }), NOW)).toBe('Payment canceled');
    expect(accountLine(summary({ state: 'odd' }), NOW)).toBe('odd');
  });

  it('prints one JSON line with --json and never the token', async () => {
    replies['GET /v1/customer/billing'] = billing();
    replies['POST /v1/customer/billing/checkout'] = { status: 200, body: { url: URL_CHECKOUT } };
    const code = await runBilling({ json: true, nowMs: NOW }, deps());
    expect(code).toBe(0);
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0] ?? '')).toEqual({
      event: 'billing',
      state: 'trial',
      subscribed: false,
      page: 'checkout',
      url: URL_CHECKOUT,
    });
    expect([...outLines, ...errLines].join('\n')).not.toContain(TOKEN);
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('explains billing that is off, a live subscription and a Stripe failure in plain sentences', async () => {
    expect(await runBilling({ json: false, nowMs: NOW }, deps())).toBe(1);
    expect(errLines.pop()).toBe(`Billing is not available on ${API}.`);

    replies['GET /v1/customer/billing'] = billing();
    replies['POST /v1/customer/billing/checkout'] = {
      status: 409,
      body: { code: 'subscription_live' },
    };
    expect(await runBilling({ json: false, nowMs: NOW }, deps())).toBe(1);
    expect(errLines.pop()).toBe(
      'Payment is already set up. Run npx passback billing again to manage it.',
    );

    replies['POST /v1/customer/billing/checkout'] = {
      status: 502,
      body: { code: 'billing_failed' },
    };
    expect(await runBilling({ json: false, nowMs: NOW }, deps())).toBe(1);
    expect(errLines.pop()).toBe('Stripe did not answer. Try again in a minute.');

    replies['GET /v1/customer/billing'] = billing({ subscribed: true, state: 'active' });
    replies['POST /v1/customer/billing/portal'] = {
      status: 409,
      body: { code: 'no_subscription' },
    };
    expect(await runBilling({ json: true, nowMs: NOW }, deps())).toBe(1);
    expect(JSON.parse(outLines.pop() ?? '')).toMatchObject({
      event: 'error',
      code: 'no_subscription',
    });

    replies['POST /v1/customer/billing/portal'] = { status: 409, body: { code: 'toString' } };
    expect(await runBilling({ json: true, nowMs: NOW }, deps())).toBe(1);
    expect(JSON.parse(outLines.pop() ?? '')).toMatchObject({
      event: 'error',
      code: 'unexpected',
      message: `Unexpected answer from ${API} (409).`,
    });
  });

  it('counts the sites and says what a new site adds only once the account pays', () => {
    expect(addSiteLines(undefined, 3)).toEqual({ lines: ['3 of 20 sites'], costs: false });
    expect(addSiteLines(summary({ subscribed: true, state: 'trial' }), 2).costs).toBe(false);
    expect(addSiteLines(summary({ subscribed: false, state: 'paused' }), 2).costs).toBe(false);
    expect(addSiteLines(summary({ subscribed: true, state: 'active' }), 4)).toEqual({
      lines: ['4 of 20 sites', 'This adds $6 a month'],
      costs: true,
    });
  });

  it('says a yearly account pays a year and what a new site adds a year', () => {
    const yearly = summary({
      subscribed: true,
      state: 'active',
      perMonthCents: 500,
      interval: 'year',
      perYearCents: 6000,
    });
    expect(accountLine(yearly, NOW)).toBe('Paid: $60 a year');
    expect(addSiteLines(yearly, 2).lines).toEqual(['2 of 20 sites', 'This adds $60 a year']);
    expect(addSiteCents(yearly)).toBe(BASE_YEAR_CENTS);
    expect(addSiteCents(summary({ subscribed: true, state: 'active' }))).toBe(BASE_CENTS);
    expect(addSiteCents(undefined)).toBe(BASE_CENTS);
    expect(accountLine({ ...yearly, perYearCents: undefined }, NOW)).toBe('Paid: $5 a month');
  });

  it('reads the interval and the yearly total from the billing body', () => {
    const base = { state: 'active', subscribed: true, trialEndsAt: null, perMonthCents: 500 };
    expect(toBillingSummary(base)).toEqual(base);
    expect(toBillingSummary({ ...base, interval: 'year', perYearCents: 6000 })).toEqual({
      ...base,
      interval: 'year',
      perYearCents: 6000,
    });
    expect(toBillingSummary({ ...base, interval: 'month', perYearCents: '6000' })).toEqual(base);
  });

  it('writes dollars without cents for whole dollars', () => {
    expect(dollars(500)).toBe('$5');
    expect(dollars(2000)).toBe('$20');
    expect(dollars(1550)).toBe('$15.50');
  });
});
