import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readWidgetAssets = vi.hoisted(() =>
  vi.fn((_from: unknown, local: boolean) => ({
    widget: Buffer.from(local ? 'local-bytes' : 'relay-bytes'),
    collector: Buffer.from('collector-bytes'),
    shot: Buffer.from('shot-bytes'),
    panel: Buffer.from('panel-bytes'),
  })),
);

vi.mock('./widget-assets', () => ({ readWidgetAssets }));

import { GET } from './route';

const context = { params: Promise.resolve({ path: ['widget.js'] }) };

describe('route widget build selection', () => {
  let root: string;

  beforeEach(async () => {
    readWidgetAssets.mockClear();
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-route-local-'));
    vi.stubEnv('PASSBACK_ROOT', root);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('serves the local widget build as widget.js inside next dev', async () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    const res = await GET(new Request('http://localhost:3003/api/passback/widget.js'), context);
    expect(await res.text()).toBe('local-bytes');
    expect(readWidgetAssets).toHaveBeenCalledWith(undefined, true);
  });

  it('serves the relay widget build as widget.js outside next dev', async () => {
    vi.stubEnv('PASSBACK_MODE', '');
    const res = await GET(new Request('http://localhost:3003/api/passback/widget.js'), context);
    expect(await res.text()).toBe('relay-bytes');
    expect(readWidgetAssets).toHaveBeenCalledWith(undefined, false);
  });
});
