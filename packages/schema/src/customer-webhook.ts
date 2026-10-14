import { z } from 'zod';
import { SiteView, isPlaneHost } from './customer';

// Webhook integration: the address a site's marks are posted to, the answer that
// carries the signing secret once, and the view of the last delivery.

const Count = z.number().int().nonnegative();

function isWebhookUrl(text: string): boolean {
  // the port is checked on the text: the URL parser drops a default port
  const authority = /^https:\/\/([^/?#]*)/.exec(text)?.[1];
  if (authority === undefined || authority.includes(':') || authority.includes('@')) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    isPlaneHost(`https://${url.hostname}`)
  );
}

export const WebhookUrl = z.string().max(2048).refine(isWebhookUrl, { message: 'invalid address' });
export type WebhookUrl = z.infer<typeof WebhookUrl>;

export const SaveWebhook = z.strictObject({ url: WebhookUrl });
export type SaveWebhook = z.infer<typeof SaveWebhook>;

export const WebhookSaved = z.strictObject({
  site: SiteView,
  signingSecret: z.string().regex(/^whsec_[A-Za-z0-9_-]{43}$/),
});
export type WebhookSaved = z.infer<typeof WebhookSaved>;

export const WebhookFailure = z.union([
  z.literal('unreachable'),
  z
    .string()
    .regex(/^http_[1-5]\d\d$/)
    .refine((v) => Number(v.slice(5)) >= 100),
]);
export type WebhookFailure = z.infer<typeof WebhookFailure>;

export const WebhookDelivery = z.strictObject({
  at: z.iso.datetime(),
  ok: z.boolean(),
  filed: Count,
  total: Count,
  failure: WebhookFailure.optional(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

export const WebhookDeliveryView = WebhookDelivery.nullable();
export type WebhookDeliveryView = z.infer<typeof WebhookDeliveryView>;
