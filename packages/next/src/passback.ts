import { createElement, Fragment, type ReactElement } from 'react';
import { widgetSettingAttrs, type WidgetSettings } from '@passback/vite-plugin/settings';
import { hotShimSource } from './hot-shim';

export type PassbackMode = 'agent' | 'relay' | 'off';
export type PassbackProps = WidgetSettings & {
  siteKey?: string;
  endpoint?: string;
  mode?: PassbackMode;
  /** Enabled by default for relay mode; ignored in agent mode. */
  screenshots?: boolean;
};

type Hosted = { address: string } | { warning: string };

const DEFAULT_ENDPOINT = 'https://api.passback.dev';

function hostedEndpoint(siteKey: string | undefined, endpoint: string | undefined): Hosted {
  const key = siteKey?.trim() ?? '';
  if (key === '') {
    return {
      warning: "passback: mode 'relay' needs siteKey, the site key from the Passback dashboard",
    };
  }
  const url = endpoint === undefined ? DEFAULT_ENDPOINT : endpoint.trim();
  if (url === '' || !URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    return {
      warning:
        'passback: siteKey needs endpoint, the http or https address of the Passback API (for example https://api.example.com)',
    };
  }
  return { address: `${url.replace(/\/+$/, '')}/v1/ingest/${encodeURIComponent(key)}` };
}

const PULL_REQUEST = /^[1-9]\d{0,8}$/;

function pullRequestFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const vercel = env.VERCEL_GIT_PULL_REQUEST_ID ?? '';
  if (PULL_REQUEST.test(vercel)) return Number(vercel);
  const review = env.REVIEW_ID ?? '';
  if (env.CONTEXT === 'deploy-preview' && PULL_REQUEST.test(review)) return Number(review);
  return undefined;
}

// withPassback inlines PASSBACK_REVIEW_ID at build; keep the read a literal member read.
function inlinedReviewId(): number | undefined {
  const value = process.env.PASSBACK_REVIEW_ID ?? '';
  return PULL_REQUEST.test(value) ? Number(value) : undefined;
}

function pullRequestScript(n: number): string {
  return `try{sessionStorage.getItem("passback:pr")||sessionStorage.setItem("passback:pr","${n}")}catch(e){}`;
}

function resolveMode(props: PassbackProps): PassbackMode {
  if (props.mode !== undefined) return props.mode;
  if (process.env.PASSBACK_MODE) return 'agent';
  return (props.siteKey?.trim() ?? '') !== '' ? 'relay' : 'agent';
}

// On deployed pages a bad look setting must never break the page: warn and use the defaults.
function hostedSettingAttrs(props: PassbackProps): Record<string, string> {
  try {
    return widgetSettingAttrs(props);
  } catch (error) {
    console.warn((error as Error).message);
    return {};
  }
}

function agentTag(props: PassbackProps, hosted?: Hosted): ReactElement | null {
  if (!process.env.PASSBACK_MODE) return null;
  const settingAttrs = widgetSettingAttrs(props);
  const base = process.env.PASSBACK_BASE_PATH ?? '';
  const buildId = process.env.PASSBACK_BUILD_ID;
  if (hosted && 'warning' in hosted) console.warn(hosted.warning);
  const beside =
    hosted && 'address' in hosted
      ? {
          'data-passback-endpoint': hosted.address,
          ...(props.screenshots === false ? {} : { 'data-passback-screenshots': 'true' }),
        }
      : {};
  return createElement(
    Fragment,
    null,
    createElement('script', {
      dangerouslySetInnerHTML: { __html: hotShimSource(base, buildId) },
    }),
    createElement('script', {
      async: true,
      src: base + '/api/passback/widget.js',
      'data-passback-chunk': base + '/api/passback/collector.js',
      ...beside,
      ...settingAttrs,
    }),
  );
}

function relayTag(props: PassbackProps): ReactElement | null {
  const hosted = hostedEndpoint(props.siteKey, props.endpoint);
  if ('warning' in hosted) {
    console.warn(hosted.warning);
    return null;
  }
  const base = process.env.PASSBACK_BASE_PATH ?? '';
  const widget = createElement('script', {
    async: true,
    src: base + '/api/passback/widget.js',
    'data-passback-chunk': base + '/api/passback/collector.js',
    'data-passback-endpoint': hosted.address,
    ...(props.screenshots === false ? {} : { 'data-passback-screenshots': 'true' }),
    ...hostedSettingAttrs(props),
  });
  const pr = pullRequestFromEnv(process.env) ?? inlinedReviewId();
  if (pr === undefined) return widget;
  return createElement(
    Fragment,
    null,
    createElement('script', { dangerouslySetInnerHTML: { __html: pullRequestScript(pr) } }),
    widget,
  );
}

// Where comments go: <Passback mode={process.env.NODE_ENV === 'production' ? 'relay' : 'agent'} siteKey="…" endpoint="…" />
// sends them to the agent while you develop and to the tracker from deployed builds.
// Change the mode line to choose: 'agent', 'relay' or 'off'. Under next dev a siteKey with no mode
// gets both: the local agent loop and the relay endpoint.
export function Passback(props: PassbackProps = {}): ReactElement | null {
  const known = [undefined, 'agent', 'relay', 'off'];
  if (!known.includes(props.mode)) {
    throw new Error(
      `passback: mode must be 'agent', 'relay' or 'off', got "${String(props.mode)}"`,
    );
  }
  const besideShim =
    process.env.PASSBACK_MODE && props.mode === undefined && (props.siteKey?.trim() ?? '') !== '';
  if (besideShim) return agentTag(props, hostedEndpoint(props.siteKey, props.endpoint));
  const mode = resolveMode(props);
  if (mode === 'off') return null;
  return mode === 'relay' ? relayTag(props) : agentTag(props);
}
