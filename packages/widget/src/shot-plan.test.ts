// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotOpenOptions, type ShotSession } from './shot-loader';
import { createShotStep } from './shot-step';
import { openShot } from './shot';
import * as grab from './shot-grab';
import * as upload from './shot-upload';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

const URL_ = 'https://relay.test/v1/ingest/demo/screenshots';
const LINE =
  '[passback] Screenshots are off for this site: pictures need the Premium plan. Drawings are sent as shapes only. https://passback.dev/pricing';
const flush = () => new Promise((resolve) => setTimeout(resolve));
const reply = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

function setup(fetchFn: () => Promise<Response>, local = false, own?: Window & typeof globalThis) {
  const where = local
    ? 'data-passback-shot-upload="/__pb/shot"'
    : 'data-passback-endpoint="https://relay.test/v1/ingest/demo"';
  document.head.innerHTML = `<script data-passback-screenshots="true" ${where} data-passback-shot="https://relay.test/shot.js"></script>`;
  const win = own ?? (Object.create(window) as Window & typeof globalThis);
  Object.defineProperty(win, 'fetch', { value: vi.fn(fetchFn), configurable: true });
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish: vi.fn(), close: vi.fn() };
  const open = vi.fn<(opts: ShotOpenOptions) => ShotSession>(() => made);
  vi.mocked(loadShotOpen).mockResolvedValue(open);
  const step = createShotStep({ doc: document, win, root, host, onLoadFailed: vi.fn() });
  const capture = async () => {
    step.toggle(true);
    await flush();
    return open.mock.calls[0]![0].capture!;
  };
  return { win, host, step, capture, fetchMock: vi.mocked(win.fetch) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('shot plan', () => {
  it('asks the relay once at init and turns capture off when the answer is screenshots false', async () => {
    const { capture, fetchMock } = setup(reply(200, { screenshots: false }));
    await flush();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(URL_, { credentials: 'omit' });
    expect((await capture())()).toBe(false);
  });

  it('warns once per page load with the Premium line', async () => {
    const win = Object.create(window) as Window & typeof globalThis;
    setup(reply(200, { screenshots: false }), false, win);
    setup(reply(200, { screenshots: false }), false, win);
    await flush();
    expect(warn).toHaveBeenCalledExactlyOnceWith(LINE);
    setup(reply(200, { screenshots: false }));
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('keeps capture on when the answer is true, an error or not json', async () => {
    const answers = [
      reply(200, { screenshots: true }),
      reply(500, { screenshots: false }),
      reply(200, 'nope'),
      reply(200, { screenshots: 'no' }),
      () => Promise.reject(new Error('down')),
    ];
    for (const answer of answers) {
      const { capture, host } = setup(answer);
      await flush();
      expect((await capture())()).toBe(true);
      expect(host.hasAttribute('data-pb-pictures')).toBe(false);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not ask the relay in local mode', async () => {
    const { fetchMock } = setup(reply(200, { screenshots: false }), true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets data-pb-pictures off on the host when pictures are off', async () => {
    const { host } = setup(reply(200, { screenshots: false }));
    await flush();
    expect(host.getAttribute('data-pb-pictures')).toBe('off');
  });

  it('the shot session sends the drawn shapes without a capture or an upload when capture is off', async () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const session = openShot({ win: window, root, host, uploadUrl: URL_, capture: () => false });
    const target = document.createElement('div');
    document.body.append(target);
    const svg = root.querySelector('svg') ?? root;
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 30, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 30, bubbles: true }));
    const outcome = await session.finish(target);
    expect(grab.grabViewport).not.toHaveBeenCalled();
    expect(upload.uploadShot).not.toHaveBeenCalled();
    expect(outcome.screenshot).toBeUndefined();
    expect(outcome.note).toBeUndefined();
    if (session.count() > 0) expect(outcome.annotations?.length).toBeGreaterThan(0);
    session.close();
  });
});
