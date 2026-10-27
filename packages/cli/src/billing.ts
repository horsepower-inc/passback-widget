// Billing in the CLI: read the account's billing view and print the Stripe link to pay or to manage payment.

import {
  commonFailure,
  fail,
  hostedCall,
  report,
  type Failure,
  type HostedDeps,
} from './hosted-call';

export const PAUSED_LINE = 'Paused — pay to turn your sites back on';
export const MAX_SITES = 20; // MAX_SITES_PER_ORG in @passback/schema
export const BASE_CENTS = 600; // a Base site, a month
export const BASE_YEAR_CENTS = 6000; // a Base site, a year
export type BillingSummary = {
  state: string;
  subscribed: boolean;
  trialEndsAt: string | null;
  perMonthCents: number;
  interval?: 'year';
  perYearCents?: number;
};

const DAY_MS = 86_400_000;
const PAYMENT_FAILED = 'Payment failed — update your card';

export function toBillingSummary(body: unknown): BillingSummary | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { state, subscribed, trialEndsAt, perMonthCents, interval, perYearCents } = body as Record<
    string,
    unknown
  >;
  if (typeof state !== 'string' || typeof subscribed !== 'boolean') return undefined;
  if (typeof perMonthCents !== 'number') return undefined;
  if (trialEndsAt !== null && typeof trialEndsAt !== 'string') return undefined;
  return {
    state,
    subscribed,
    trialEndsAt,
    perMonthCents,
    ...(interval === 'year' && { interval }),
    ...(typeof perYearCents === 'number' && { perYearCents }),
  };
}

export async function readBilling(deps: HostedDeps): Promise<BillingSummary | undefined> {
  const answer = await hostedCall(deps, 'GET', '/v1/customer/billing');
  if (answer.kind !== 'answer' || answer.status !== 200) return undefined;
  return toBillingSummary(answer.body);
}

export function dollars(cents: number): string {
  const whole = cents / 100;
  return Number.isInteger(whole) ? `$${whole}` : `$${whole.toFixed(2)}`;
}

function trialLine(view: BillingSummary, nowMs: number): string {
  if (view.trialEndsAt === null) return 'Trial';
  const days = Math.max(0, Math.ceil((Date.parse(view.trialEndsAt) - nowMs) / DAY_MS));
  if (days === 0) return 'Trial: ends today';
  return days === 1 ? 'Trial: 1 day left' : `Trial: ${days} days left`;
}

const STATE_LINES: Record<string, (view: BillingSummary, nowMs: number) => string> = {
  trial: trialLine,
  active: (view) =>
    view.interval === 'year' && view.perYearCents !== undefined
      ? `Paid: ${dollars(view.perYearCents)} a year`
      : `Paid: ${dollars(view.perMonthCents)} a month`,
  past_due: () => PAYMENT_FAILED,
  grace: (view) => (view.subscribed ? PAYMENT_FAILED : 'Your trial has ended'),
  paused: () => PAUSED_LINE,
  canceled: () => 'Payment canceled',
};

export function accountLine(view: BillingSummary, nowMs: number): string {
  const line = Object.hasOwn(STATE_LINES, view.state) ? STATE_LINES[view.state] : undefined;
  return line ? line(view, nowMs) : view.state;
}

export function addSiteLines(
  view: BillingSummary | undefined,
  sitesAfter: number,
): { lines: string[]; costs: boolean } {
  const lines = [`${sitesAfter} of ${MAX_SITES} sites`];
  const costs = view !== undefined && view.subscribed && view.state !== 'trial';
  if (costs) {
    lines.push(
      view.interval === 'year'
        ? `This adds ${dollars(BASE_YEAR_CENTS)} a year`
        : `This adds ${dollars(BASE_CENTS)} a month`,
    );
  }
  return { lines, costs };
}

export function addSiteCents(view: BillingSummary | undefined): number {
  return view?.interval === 'year' ? BASE_YEAR_CENTS : BASE_CENTS;
}

function unexpected(api: string, status: number): Failure {
  return { code: 'unexpected', message: `Unexpected answer from ${api} (${status}).` };
}

async function readView(deps: HostedDeps): Promise<BillingSummary | Failure> {
  const answer = await hostedCall(deps, 'GET', '/v1/customer/billing');
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected('', 0);
  if (answer.status === 404) {
    return { code: 'billing_off', message: `Billing is not available on ${answer.api}.` };
  }
  const view = answer.status === 200 ? toBillingSummary(answer.body) : undefined;
  return view ?? unexpected(answer.api, answer.status);
}

const CONFLICTS: Partial<Record<string, Failure>> = {
  subscription_live: {
    code: 'subscription_live',
    message: 'Payment is already set up. Run npx passback billing again to manage it.',
  },
  no_subscription: {
    code: 'no_subscription',
    message: 'There is no payment to manage yet. Run npx passback billing again to start paying.',
  },
};

function linkFailure(api: string, status: number, body: unknown): Failure {
  const code = (body as { code?: unknown } | null | undefined)?.code;
  const conflict =
    status === 409 && typeof code === 'string' && Object.hasOwn(CONFLICTS, code)
      ? CONFLICTS[code]
      : undefined;
  if (conflict) return conflict;
  if (status === 502) {
    return { code: 'billing_failed', message: 'Stripe did not answer. Try again in a minute.' };
  }
  return unexpected(api, status);
}

async function readLink(page: 'checkout' | 'portal', deps: HostedDeps): Promise<string | Failure> {
  const answer = await hostedCall(deps, 'POST', `/v1/customer/billing/${page}`);
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected('', 0);
  const url = (answer.body as { url?: unknown } | null | undefined)?.url;
  if (answer.status === 200 && typeof url === 'string' && url.startsWith('https://')) return url;
  return linkFailure(answer.api, answer.status, answer.body);
}

export async function runBilling(
  opts: { json: boolean; nowMs: number },
  deps: HostedDeps,
): Promise<number> {
  const view = await readView(deps);
  if ('code' in view) return fail(deps, opts.json, view);
  const page = view.subscribed ? 'portal' : 'checkout';
  const url = await readLink(page, deps);
  if (typeof url !== 'string') return fail(deps, opts.json, url);
  const label = page === 'portal' ? 'Manage payment at Stripe' : 'Start paying at Stripe';
  report(
    deps,
    opts.json,
    { event: 'billing', state: view.state, subscribed: view.subscribed, page, url },
    [accountLine(view, opts.nowMs), `${label}: ${url}`],
  );
  return 0;
}
