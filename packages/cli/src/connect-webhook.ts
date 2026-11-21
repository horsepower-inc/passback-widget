import { fail, hostedCall, commonFailure, report, type HostedDeps } from './hosted';
import { findSite, unexpected } from './connect';

export type ConnectWebhookOptions = { root: string; url: string; site?: string; json: boolean };

type Answer = Awaited<ReturnType<typeof hostedCall>>;
type Failure = { code: string; message: string };

function refusal(answer: Answer): Failure | null {
  if (answer.kind !== 'answer') return null;
  if (answer.status === 429) {
    return { code: 'rate_limited', message: 'Too many tries. Wait a minute.' };
  }
  const code = (answer.body as { code?: unknown } | null)?.code;
  if (answer.status === 400 && code === 'bad_body') {
    return { code: 'bad_body', message: 'That is not an https address Passback can send to.' };
  }
  if (answer.status === 502 && code === 'unreachable') {
    return {
      code: 'unreachable',
      message:
        'Passback could not send a test message to that address. Check that it answers with a 2xx status.',
    };
  }
  return null;
}

export async function runConnectWebhook(
  opts: ConnectWebhookOptions,
  deps: HostedDeps,
): Promise<number> {
  const site = await findSite(opts, deps);
  if ('code' in site) return fail(deps, opts.json, site);
  const answer = await hostedCall(
    deps,
    'PUT',
    `/v1/customer/sites/${encodeURIComponent(site.siteId)}/webhook`,
    { url: opts.url },
  );
  const failure = refusal(answer) ?? commonFailure(answer);
  if (failure) return fail(deps, opts.json, failure);
  const signingSecret =
    answer.kind === 'answer' && answer.status === 200
      ? (answer.body as { signingSecret?: unknown } | null)?.signingSecret
      : undefined;
  if (answer.kind !== 'answer' || typeof signingSecret !== 'string') {
    return fail(deps, opts.json, unexpected(answer));
  }
  report(
    deps,
    opts.json,
    { event: 'connected', site: site.name, tracker: 'webhook', signingSecret },
    [
      `Webhook saved for ${site.name}.`,
      `Signing secret (shown once, keep it now): ${signingSecret}`,
      'Check each delivery with the Passback-Signature header; see https://passback.dev/docs/webhook/.',
    ],
  );
  return 0;
}
