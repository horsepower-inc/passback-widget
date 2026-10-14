import { z } from 'zod';
import { Plan } from './billing';
import { AdoWorkItemType, CUSTOMER_TRACKERS, GithubSink } from './customer-integration';

export * from './customer-integration';

// Customer surface: sites, tracker integrations and credential verification.
// A credential appears only in a request type, never in a view type.
//
// Status each error code travels with:
//   401 unauthorized
//   403 csrf
//   404 not_found
//   400 bad_body, target_not_visible
//   402 account_paused
//   409 not_connected, site_limit, pull_request_required, subscription_live, no_subscription, no_sites,
//       not_editable, tracker_changed
//   422 credential_rejected, workspace_not_found, pull_request_not_found, pull_request_not_open, intake_not_enabled
//   429 rate_limited
//   502 file_failed, unreachable, unexpected_response, billing_failed

export const MAX_SITE_ORIGINS = 10;
export const MAX_SITES_PER_ORG = 20;

export const SiteName = z.string().trim().min(1).max(80);
export type SiteName = z.infer<typeof SiteName>;

const ExactOrigin = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
// One `*` in the leftmost host label, at least two more labels after it.
const OriginPattern = /^https?:\/\/[A-Za-z0-9-]*\*[A-Za-z0-9-]*(\.[A-Za-z0-9-]+){2,}(:\d{1,5})?$/;

export const SiteOrigin = z
  .string()
  .max(200)
  .refine((v) => ExactOrigin.test(v) || OriginPattern.test(v), { message: 'invalid origin' });
export type SiteOrigin = z.infer<typeof SiteOrigin>;

export const SiteOrigins = z
  .array(SiteOrigin)
  .min(1)
  .max(MAX_SITE_ORIGINS)
  .refine((v) => v.filter((o) => o.includes('*')).length <= 1, {
    message: 'at most one wildcard pattern per site',
  });
export type SiteOrigins = z.infer<typeof SiteOrigins>;

export const CreateSite = z.strictObject({
  name: SiteName,
  origins: SiteOrigins,
});
export type CreateSite = z.infer<typeof CreateSite>;

export const UpdateSite = z
  .strictObject({
    name: SiteName.optional(),
    origins: SiteOrigins.optional(),
  })
  .refine((v) => v.name !== undefined || v.origins !== undefined, {
    message: 'at least one of name or origins is required',
  });
export type UpdateSite = z.infer<typeof UpdateSite>;

export const VerifyTarget = z.strictObject({
  id: z.string(),
  label: z.string(),
  children: z.array(z.strictObject({ id: z.string(), label: z.string() })).optional(),
  intakeEnabled: z.boolean().optional(), // Plane only: whether the project has Intake switched on
});
export type VerifyTarget = z.infer<typeof VerifyTarget>;

export const VerifyResponse = z.strictObject({
  account: z.string(),
  targets: z.array(VerifyTarget),
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

export const IntegrationView = z.strictObject({
  tracker: z.enum([...CUSTOMER_TRACKERS, 'webhook']),
  project: z.string(),
  projectId: z.string().optional(),
  workspace: z.string().optional(),
  sink: GithubSink.optional(),
  workItemType: AdoWorkItemType.optional(),
  intake: z.literal(true).optional(), // Plane only: marks are filed to the project's Intake queue
  // who Linear shows as the author of filed issues; present only for a Linear connection made with Connect with Linear
  filedAs: z.enum(['passback', 'you']).optional(),
  targetName: z.string().optional(), // readable name of the place comments go
  account: z.string(),
  verifiedAt: z.iso.datetime(),
  testedAt: z.iso.datetime().optional(), // when a test comment was last filed through this connection
  credential: z.literal('set'),
});
export type IntegrationView = z.infer<typeof IntegrationView>;

export const SiteView = z.strictObject({
  siteId: z.string(),
  name: z.string(),
  origins: z.array(z.string()),
  snippet: z.string(),
  integration: IntegrationView.nullable(),
  lastSeen: z.strictObject({ at: z.iso.datetime(), origin: z.string() }).optional(), // when and where the widget last loaded
  createdAt: z.iso.datetime(),
  plan: Plan.optional(),
});
export type SiteView = z.infer<typeof SiteView>;

export const MeView = z.strictObject({
  user: z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().optional(),
  }),
  org: z.strictObject({ id: z.string(), name: z.string() }),
  csrf: z.string(),
});
export type MeView = z.infer<typeof MeView>;

export const PullRequestSummary = z.strictObject({
  number: z.number().int().min(1).max(2_147_483_647),
  title: z.string(),
  branch: z.string(), // the head branch name
});
export type PullRequestSummary = z.infer<typeof PullRequestSummary>;

export const PullRequestList = z.strictObject({
  pullRequests: z.array(PullRequestSummary).max(100),
});
export type PullRequestList = z.infer<typeof PullRequestList>;

export const TestMarkRequest = z.strictObject({
  pullRequest: z.number().int().min(1).max(2_147_483_647).optional(),
});
export type TestMarkRequest = z.infer<typeof TestMarkRequest>;

export const TestMarkResponse = z.strictObject({
  ref: z.string(),
  url: z.url().optional(),
});
export type TestMarkResponse = z.infer<typeof TestMarkResponse>;

const Count = z.number().int().nonnegative();

export const SiteStatsDay = z.strictObject({
  day: z.iso.date(), // a UTC day, YYYY-MM-DD
  comments: Count,
});
export type SiteStatsDay = z.infer<typeof SiteStatsDay>;

export const SiteStatsView = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/), // the UTC month the totals cover
  comments: Count, // comments received this month
  included: z.number().int().positive(), // comments a site may send per month
  filed: Count, // of those, filed to the tracker
  failed: Count, // of those, could not be filed
  days: z.array(SiteStatsDay).length(14), // oldest first, the last one is today
});
export type SiteStatsView = z.infer<typeof SiteStatsView>;

export const CustomerErrorCode = z.enum([
  'unauthorized',
  'csrf',
  'not_found',
  'bad_body',
  'rate_limited',
  'not_connected',
  'file_failed',
  'site_limit',
  'target_not_visible',
  'credential_rejected',
  'workspace_not_found',
  'unreachable',
  'unexpected_response',
  'pull_request_required',
  'pull_request_not_found',
  'pull_request_not_open',
  'account_paused',
  'subscription_live',
  'no_subscription',
  'no_sites',
  'billing_failed',
  'intake_not_enabled',
  'not_editable',
  'tracker_changed',
]);
export type CustomerErrorCode = z.infer<typeof CustomerErrorCode>;

export const CustomerError = z.strictObject({ code: CustomerErrorCode });
export type CustomerError = z.infer<typeof CustomerError>;
