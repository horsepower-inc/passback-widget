import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Passback } from './passback';

function children(element: ReactElement | null): ReactElement[] {
  if (element === null) throw new Error('expected an element');
  return (element.props as { children: ReactElement[] }).children;
}

describe('Passback panel attribute', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names panel.js in data-passback-panel on the agent widget script', () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    vi.stubEnv('PASSBACK_BASE_PATH', '');
    const widget = children(Passback())[1] as ReactElement;
    expect(widget.props).toMatchObject({ 'data-passback-panel': '/api/passback/panel.js' });
  });

  it('prefixes the panel url with PASSBACK_BASE_PATH', () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    vi.stubEnv('PASSBACK_BASE_PATH', '/docs');
    const widget = children(Passback())[1] as ReactElement;
    expect(widget.props).toMatchObject({ 'data-passback-panel': '/docs/api/passback/panel.js' });
  });

  it('leaves the panel attribute off the relay widget script', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    vi.stubEnv('PASSBACK_BASE_PATH', '');
    vi.stubEnv('VERCEL_GIT_PULL_REQUEST_ID', '');
    const script = Passback({
      siteKey: 'pb_abc',
      endpoint: 'https://api.example.com',
    }) as ReactElement;
    expect(script.type).toBe('script');
    expect(script.props).not.toHaveProperty('data-passback-panel');
  });
});
