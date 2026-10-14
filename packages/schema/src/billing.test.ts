import { describe, expect, it } from 'vitest';
import {
  AccountState,
  ACCOUNT_STATES,
  BillingRedirect,
  BillingInterval,
  BillingView,
  BILLING_INTERVALS,
  PLAN_PRICE_CENTS,
  PLAN_YEAR_PRICE_CENTS,
  PLANS,
  SetBillingInterval,
  SetSitePlan,
  StartPaying,
} from './billing';
import { CustomerErrorCode, SiteView } from './customer';

const trial = {
  state: 'trial',
  subscribed: false,
  trialEndsAt: '2026-10-19T00:00:00Z',
  graceEndsAt: null,
  cancelAt: null,
  nextInvoiceAt: null,
  perMonthCents: 500,
  sites: [{ siteId: 'site_1', name: 'Shop', plan: 'base' }],
  cardLast4: null,
  invoices: [],
};

const invoice = {
  id: 'in_1',
  createdAt: '2026-10-01T00:00:00Z',
  amountCents: 2000,
  status: 'paid',
  pdfUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
};

const site = {
  siteId: 'site_1',
  name: 'Shop',
  origins: ['https://shop.example.com'],
  snippet: '<script></script>',
  integration: null,
  createdAt: '2026-10-01T00:00:00Z',
};

describe('billing schemas', () => {
  it('prices Base at 600 cents and Premium at 2000 cents a month', () => {
    expect(PLANS).toEqual(['base', 'premium']);
    expect(PLAN_PRICE_CENTS).toEqual({ base: 600, premium: 2000 });
  });

  it('knows the two billing intervals and the yearly prices', () => {
    expect(BILLING_INTERVALS).toEqual(['month', 'year']);
    expect(BillingInterval.safeParse('year').success).toBe(true);
    expect(BillingInterval.safeParse('week').success).toBe(false);
    expect(PLAN_YEAR_PRICE_CENTS).toEqual({ base: 6000, premium: 18000 });
  });

  it('accepts month and year for a Checkout and for an interval switch and nothing else', () => {
    for (const interval of ['month', 'year']) {
      expect(SetBillingInterval.safeParse({ interval }).success).toBe(true);
      expect(StartPaying.safeParse({ interval }).success).toBe(true);
    }
    expect(StartPaying.safeParse({}).success).toBe(true);
    expect(SetBillingInterval.safeParse({}).success).toBe(false);
    for (const bad of [{ interval: 'week' }, { interval: null }, { interval: 'year', x: 1 }]) {
      expect(SetBillingInterval.safeParse(bad).success).toBe(false);
      expect(StartPaying.safeParse(bad).success).toBe(false);
    }
    expect(StartPaying.safeParse({ x: 1 }).success).toBe(false);
  });

  it('parses a billing view with and without the interval and the yearly total', () => {
    expect(BillingView.safeParse(trial).success).toBe(true);
    expect(BillingView.safeParse({ ...trial, interval: 'year', perYearCents: 6000 }).success).toBe(true);
    expect(BillingView.safeParse({ ...trial, interval: 'week' }).success).toBe(false);
    expect(BillingView.safeParse({ ...trial, perYearCents: -1 }).success).toBe(false);
  });

  it('knows the six account states and refuses any other', () => {
    expect(ACCOUNT_STATES).toEqual(['trial', 'active', 'past_due', 'grace', 'paused', 'canceled']);
    for (const s of ACCOUNT_STATES) expect(AccountState.safeParse(s).success).toBe(true);
    expect(AccountState.safeParse('checkout_open').success).toBe(false);
  });

  it('sets a site plan to base or premium and nothing else', () => {
    expect(SetSitePlan.safeParse({ plan: 'base' }).success).toBe(true);
    expect(SetSitePlan.safeParse({ plan: 'premium' }).success).toBe(true);
    expect(SetSitePlan.safeParse({ plan: null }).success).toBe(false);
    expect(SetSitePlan.safeParse({ plan: 'gold' }).success).toBe(false);
    expect(SetSitePlan.safeParse({ plan: 'base', x: 1 }).success).toBe(false);
  });

  it('parses a billing view in trial with no subscription and one with an invoice', () => {
    expect(BillingView.safeParse(trial).success).toBe(true);
    const active = {
      ...trial,
      state: 'active',
      subscribed: true,
      trialEndsAt: null,
      nextInvoiceAt: '2026-11-01T00:00:00Z',
      perMonthCents: 2000,
      sites: [...trial.sites, { siteId: 'site_2', name: 'Blog', plan: 'premium' }],
      cardLast4: '4242',
      invoices: [invoice, { ...invoice, id: 'in_0', pdfUrl: null }],
    };
    expect(BillingView.safeParse(active).success).toBe(true);
  });

  it('refuses a card value that is not four digits and an invoice without a pdfUrl key', () => {
    for (const c of ['424', '42424', 'abcd']) {
      expect(BillingView.safeParse({ ...trial, cardLast4: c }).success).toBe(false);
    }
    const noPdf: Partial<typeof invoice> = { ...invoice };
    delete noPdf.pdfUrl;
    expect(BillingView.safeParse({ ...trial, invoices: [noPdf] }).success).toBe(false);
  });

  it('parses a redirect only when it carries an address', () => {
    expect(BillingRedirect.safeParse({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }).success).toBe(true);
    expect(BillingRedirect.safeParse({}).success).toBe(false);
    expect(BillingRedirect.safeParse({ url: 'not a url' }).success).toBe(false);
  });

  it('a site view parses with a plan and without one', () => {
    expect(SiteView.safeParse(site).success).toBe(true);
    expect(SiteView.safeParse({ ...site, plan: 'premium' }).success).toBe(true);
    expect(SiteView.safeParse({ ...site, plan: 'gold' }).success).toBe(false);
  });

  it('knows the five billing error codes', () => {
    for (const c of ['account_paused', 'subscription_live', 'no_subscription', 'no_sites', 'billing_failed']) {
      expect(CustomerErrorCode.safeParse(c).success).toBe(true);
    }
  });
});
