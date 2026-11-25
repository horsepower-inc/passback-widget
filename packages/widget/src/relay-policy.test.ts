// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotOpenOptions, type ShotSession } from './shot-loader';
import { createShotStep } from './shot-step';
import { readRelayPolicy } from './relay-policy';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

const URL_ = 'https://relay.test/v1/ingest/demo/screenshots';
const ENDPOINT = 'data-passback-endpoint="https://relay.test/v1/ingest/demo"';
const flush = () => new Promise((resolve) => setTimeout(resolve));
const reply = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
const FULL = { screenshots: true, drawings: true, maxBytes: 5242880, gzip: true };
const NO_PICTURES = { screenshots: false, drawings: true, maxBytes: 5242880, gzip: false };

type Win = Window & typeof globalThis;
const page = (): Win => Object.create(window) as Win;

function setup(
  fetchFn: () => Promise<Response>,
  opts: { attrs?: string; shots?: boolean; win?: Win } = {},
) {
  const { attrs = ENDPOINT, shots = true, win = page() } = opts;
  document.head.innerHTML = `<script ${shots ? 'data-passback-screenshots="true"' : ''} ${attrs} data-passback-shot="https://relay.test/shot.js"></script>`;
  if (!Object.getOwnPropertyDescriptor(win, 'fetch'))
    Object.defineProperty(win, 'fetch', { value: vi.fn(fetchFn), configurable: true });
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish: vi.fn(), close: vi.fn() };
  const open = vi.fn<(o: ShotOpenOptions) => ShotSession>(() => made);
  vi.mocked(loadShotOpen).mockResolvedValue(open);
  const step = createShotStep({ doc: document, win, root, host, onLoadFailed: vi.fn() });
  const capture = async () => {
    step.toggle(true);
    await flush();
    return open.mock.calls[0]![0].capture!;
  };
  return { win, host, root, step, capture, fetchMock: vi.mocked(win.fetch) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('relay policy', () => {
  it('discovers policy without screenshot opt-in once per page', async () => {
    const { win, fetchMock, step } = setup(reply(200, FULL), { shots: false });
    await flush();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(URL_, { credentials: 'omit' });
    expect(readRelayPolicy(document, win)).toEqual({ maxBytes: 5242880, gzip: true });
    expect(readRelayPolicy(document, win)).toEqual({ maxBytes: 5242880, gzip: true });
    expect(step.enabled).toBe(false);
    setup(reply(200, FULL), { shots: false, win });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one policy request with screenshot capture', async () => {
    const { win, fetchMock, capture } = setup(reply(200, FULL));
    await flush();
    expect((await capture())()).toBe(true);
    expect(readRelayPolicy(document, win)).toEqual({ maxBytes: 5242880, gzip: true });
    setup(reply(200, FULL), { win });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains transport policy while preserving screenshot refusal', async () => {
    const { win, host, capture, fetchMock } = setup(reply(200, NO_PICTURES));
    await flush();
    expect(readRelayPolicy(document, win)).toEqual({ maxBytes: 5242880, gzip: false });
    expect((await capture())()).toBe(false);
    expect(host.getAttribute('data-pb-pictures')).toBe('off');
    expect(warn).toHaveBeenCalledTimes(1);
    const next = setup(reply(200, NO_PICTURES), { win });
    expect(next.host.getAttribute('data-pb-pictures')).toBe('off');
    expect((await next.capture())()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy fallback when maxBytes is absent', async () => {
    const old = setup(reply(200, { screenshots: true, drawings: true }));
    await flush();
    expect(readRelayPolicy(document, old.win)).toBeUndefined();
    expect((await old.capture())()).toBe(true);
    const refused = setup(reply(200, { screenshots: false, drawings: true, gzip: true }));
    await flush();
    expect(readRelayPolicy(document, refused.win)).toBeUndefined();
    expect((await refused.capture())()).toBe(false);
  });

  it('leaves local screenshots without a relay policy request', async () => {
    const { win, fetchMock, capture } = setup(reply(200, FULL), {
      attrs: 'data-passback-shot-upload="/__pb/shot"',
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readRelayPolicy(document, win)).toBeUndefined();
    expect((await capture())()).toBe(true);
  });

  it('exposes fallback until the policy answer arrives', async () => {
    let answer!: (res: Response) => void;
    const { win, fetchMock, capture } = setup(() => new Promise<Response>((r) => (answer = r)));
    const picture = await capture();
    expect(picture()).toBe(true);
    expect(readRelayPolicy(document, win)).toBeUndefined();
    answer(new Response(JSON.stringify(NO_PICTURES), { status: 200 }));
    await flush();
    expect(readRelayPolicy(document, win)).toEqual({ maxBytes: 5242880, gzip: false });
    expect(picture()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps capture and no policy after fetch failure without retry', async () => {
    const failures = [
      () => Promise.reject(new Error('down')),
      () => {
        throw new Error('sync');
      },
    ];
    for (const failure of failures) {
      const first = setup(failure as () => Promise<Response>);
      await flush();
      expect(readRelayPolicy(document, first.win)).toBeUndefined();
      expect((await first.capture())()).toBe(true);
      setup(failure as () => Promise<Response>, { win: first.win });
      await flush();
      expect(first.fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a non-200 policy answer without retry', async () => {
    const first = setup(reply(500, { screenshots: false, maxBytes: 5242880, gzip: true }));
    await flush();
    expect(readRelayPolicy(document, first.win)).toBeUndefined();
    expect((await first.capture())()).toBe(true);
    setup(reply(500, {}), { win: first.win });
    await flush();
    expect(first.fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps capture and no policy after invalid JSON without retry', async () => {
    const first = setup(reply(200, 'nope'));
    await flush();
    expect(readRelayPolicy(document, first.win)).toBeUndefined();
    expect((await first.capture())()).toBe(true);
    setup(reply(200, 'nope'), { win: first.win });
    await flush();
    expect(first.fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
