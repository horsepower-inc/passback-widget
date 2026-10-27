// Where comments go: the local agent, the hosted relay, or nowhere.

export type PassbackMode = 'agent' | 'relay' | 'off';
export type HostedOptions = { siteKey?: string; endpoint?: string; mode?: PassbackMode };

// Used only when endpoint is left out; an explicit empty string still fails.
const DEFAULT_ENDPOINT = 'https://api.passback.dev';

export function checkMode(mode: unknown): void {
  if (mode === undefined || mode === 'agent' || mode === 'relay' || mode === 'off') return;
  throw new Error(`passback: mode must be 'agent', 'relay' or 'off', got "${String(mode)}"`);
}

export function resolveMode(options: HostedOptions, command: 'serve' | 'build'): PassbackMode {
  if (options.mode !== undefined) return options.mode;
  if (command === 'serve') return 'agent';
  return typeof options.siteKey === 'string' && options.siteKey.trim() !== '' ? 'relay' : 'agent';
}

export function hostedEndpoint(options: HostedOptions): string {
  const siteKey = options.siteKey?.trim();
  if (!siteKey) {
    throw new Error(
      "passback: mode 'relay' needs siteKey, the site key from the Passback dashboard",
    );
  }
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).trim();
  if (
    !endpoint ||
    !URL.canParse(endpoint) ||
    !['http:', 'https:'].includes(new URL(endpoint).protocol)
  ) {
    throw new Error(
      'passback: siteKey needs endpoint, the http or https address of the Passback API (for example https://api.example.com)',
    );
  }
  return `${endpoint.replace(/\/+$/, '')}/v1/ingest/${encodeURIComponent(siteKey)}`;
}
