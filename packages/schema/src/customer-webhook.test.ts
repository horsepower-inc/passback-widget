import { describe, expect, it } from 'vitest';
import { IntegrationView } from './customer';
import {
  SaveWebhook,
  WebhookDelivery,
  WebhookDeliveryView,
  WebhookSaved,
  WebhookUrl,
} from './customer-webhook';

const at = '2026-10-12T10:00:00.000Z';
const secret = `whsec_${'a'.repeat(43)}`;

const site = {
  siteId: 'site_1',
  name: 'Shop',
  origins: ['https://shop.example.com'],
  snippet: '<script></script>',
  integration: null,
  createdAt: at,
};

describe('customer webhook schemas', () => {
  it('accepts an https address with a path and a token and refuses http, a port, userinfo and a private host', () => {
    expect(WebhookUrl.safeParse('https://hooks.example.com/in/abc123?token=x_y').success).toBe(
      true,
    );
    for (const bad of [
      'http://hooks.example.com/in',
      'https://hooks.example.com:8443/in',
      'https://hooks.example.com:443/in',
      'https://user:pw@hooks.example.com/in',
      'https://user@hooks.example.com/in',
      'https://localhost/in',
      'https://printer.local/in',
      'https://db.internal/in',
      'https://8.8.8.8/in',
      'https://intranet/in',
      `https://hooks.example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(WebhookUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('refuses unknown keys on the save body', () => {
    expect(SaveWebhook.safeParse({ url: 'https://hooks.example.com/in' }).success).toBe(true);
    expect(SaveWebhook.safeParse({ url: 'https://hooks.example.com/in', extra: 1 }).success).toBe(
      false,
    );
  });

  it('accepts a saved answer with a site and a signing secret of the fixed shape', () => {
    expect(WebhookSaved.safeParse({ site, signingSecret: secret }).success).toBe(true);
    expect(WebhookSaved.safeParse({ site, signingSecret: 'whsec_short' }).success).toBe(false);
    expect(WebhookSaved.safeParse({ site, signingSecret: `sk_${'a'.repeat(43)}` }).success).toBe(
      false,
    );
  });

  it('accepts a delivery with a failure code and refuses a free-text failure', () => {
    const base = { at, ok: false, filed: 1, total: 2 };
    expect(WebhookDelivery.safeParse({ ...base, failure: 'unreachable' }).success).toBe(true);
    expect(WebhookDelivery.safeParse({ ...base, failure: 'http_503' }).success).toBe(true);
    expect(WebhookDelivery.safeParse({ ...base, failure: 'http_99' }).success).toBe(false);
    expect(WebhookDelivery.safeParse({ ...base, failure: 'http_600' }).success).toBe(false);
    expect(
      WebhookDelivery.safeParse({ ...base, failure: 'connection reset by peer' }).success,
    ).toBe(false);
    expect(WebhookDeliveryView.safeParse(null).success).toBe(true);
  });

  it('lets an integration view carry the webhook tracker', () => {
    const view = {
      tracker: 'webhook',
      project: 'hooks.example.com',
      account: 'hooks.example.com',
      verifiedAt: at,
      credential: 'set',
    };
    expect(IntegrationView.safeParse(view).success).toBe(true);
    expect(IntegrationView.safeParse({ ...view, tracker: 'other' }).success).toBe(false);
  });
});
