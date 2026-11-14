import { z } from 'zod';

// Billing surface: one subscription per account, each site a line priced by its plan.
export const PLANS = ['base', 'premium'] as const;
export const Plan = z.enum(PLANS);
export type Plan = z.infer<typeof Plan>;

// US cents per site per month.
export const PLAN_PRICE_CENTS = { base: 600, premium: 2000 } as const;

// US cents per site per year, charged once.
export const PLAN_YEAR_PRICE_CENTS = { base: 6000, premium: 18000 } as const;

export const BILLING_INTERVALS = ['month', 'year'] as const;
export const BillingInterval = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const SetBillingInterval = z.strictObject({ interval: BillingInterval });
export type SetBillingInterval = z.infer<typeof SetBillingInterval>;

// The body of the Checkout call; absent means month.
export const StartPaying = z.strictObject({ interval: BillingInterval.optional() });
export type StartPaying = z.infer<typeof StartPaying>;

// prettier-ignore
export const ACCOUNT_STATES = ['trial', 'active', 'past_due', 'grace', 'paused', 'canceled', 'ended'] as const;
export const AccountState = z.enum(ACCOUNT_STATES);
export type AccountState = z.infer<typeof AccountState>;

export const SetSitePlan = z.strictObject({ plan: Plan });
export type SetSitePlan = z.infer<typeof SetSitePlan>;

// The address of Stripe's Checkout page or customer portal.
export const BillingRedirect = z.strictObject({ url: z.url() });
export type BillingRedirect = z.infer<typeof BillingRedirect>;

export const InvoiceView = z.strictObject({
  id: z.string(),
  createdAt: z.iso.datetime(),
  amountCents: z.number().int(),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  pdfUrl: z.url().nullable(),
});
export type InvoiceView = z.infer<typeof InvoiceView>;

export const BillingSiteLine = z.strictObject({ siteId: z.string(), name: z.string(), plan: Plan });
export type BillingSiteLine = z.infer<typeof BillingSiteLine>;

const When = z.iso.datetime().nullable();

export const BillingView = z.strictObject({
  state: AccountState,
  subscribed: z.boolean(), // a live subscription exists: no Checkout, the portal instead
  trialEndsAt: When,
  graceEndsAt: When,
  cancelAt: When, // the end of the paid period while a cancel is pending
  nextInvoiceAt: When,
  perMonthCents: z.number().int().min(0),
  interval: BillingInterval.optional(), // the live subscription's interval, or the one a new Checkout would use: month
  perYearCents: z.number().int().min(0).optional(), // what the account's sites cost on the yearly prices
  sites: z.array(BillingSiteLine),
  // prettier-ignore
  cardLast4: z.string().regex(/^\d{4}$/).nullable(),
  amountDueCents: z.number().int().min(0).nullable().optional(), // what Stripe could not charge, while a payment is failing
  nextRetryAt: z.iso.datetime().nullable().optional(), // Stripe's next attempt
  refundUntil: z.iso.datetime().nullable().optional(), // the end of the 14-day full-refund window; absent or null outside it
  refundCents: z.number().int().min(0).nullable().optional(), // what a full refund returns, in US cents; present with refundUntil, absent or null outside the window
  invoices: z.array(InvoiceView),
});
export type BillingView = z.infer<typeof BillingView>;

export const BILLING_CANCEL_OUTCOMES = ['period_end', 'resumed', 'refunded'] as const;
export const BillingCancelOutcome = z.enum(BILLING_CANCEL_OUTCOMES);
export type BillingCancelOutcome = z.infer<typeof BillingCancelOutcome>;

// The body of cancel (period_end), resume (resumed) and cancel-refund (refunded); the three calls take no request body.
export const BillingCancelResult = z.strictObject({ outcome: BillingCancelOutcome });
export type BillingCancelResult = z.infer<typeof BillingCancelResult>;
