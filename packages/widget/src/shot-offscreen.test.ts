// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInk, type Ink } from './shot-ink';
import { mountVeil } from './shot-veil';
import { mountTools } from './shot-tools';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import type { Shape } from './shot-shapes';
import { openShot } from './shot';
import { shotExtra } from './shot-step';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-veil', () => ({ mountVeil: vi.fn() }));
vi.mock('./shot-tools', () => ({ mountTools: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

const VH = 800;
const circle = (y: number): Shape => ({
  tool: 'box',
  from: { x: 100, y },
  to: { x: 160, y: y + 60 },
});
const captured = {
  ok: true as const,
  blob: new Blob(['picture']),
  mime: 'image/webp' as const,
  width: 800,
  height: 600,
  masked: 0,
};
const screenshot = {
  id: 'a'.repeat(32),
  mime: captured.mime,
  width: 800,
  height: 600,
  masked: 0,
  bytes: 7,
};
let shapes: readonly Shape[];

function element(top = 100, bottom = 140): Element {
  const el = document.createElement('div');
  document.body.append(el);
  el.getBoundingClientRect = () => ({ left: 0, top, bottom, right: 50 }) as DOMRect;
  return el;
}

async function send(list: Shape[], el = element()) {
  shapes = list;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const session = openShot({ win: window, root, host, uploadUrl: '/s', fetchFn: vi.fn() });
  const outcome = await session.finish(el);
  return { outcome, deps: vi.mocked(grabViewport).mock.calls[0]![0] };
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 6000, configurable: true });
  const ink = {
    tool: 'box',
    shapes: () => shapes,
    setActive: vi.fn(),
    destroy: vi.fn(),
    undo: vi.fn(),
    clear: vi.fn(),
  } as unknown as Ink;
  vi.mocked(mountInk).mockImplementation(() => ink);
  vi.mocked(mountVeil).mockReturnValue({ refresh: vi.fn(), destroy: vi.fn() });
  vi.mocked(mountTools).mockReturnValue({
    element: document.createElement('div'),
    setCount: vi.fn(),
    destroy: vi.fn(),
  });
  vi.mocked(grabViewport).mockResolvedValue(captured);
  vi.mocked(uploadShot).mockResolvedValue({ ok: true, screenshot });
});

describe('a picture of the drawings', () => {
  it('a drawing scrolled out of the viewport is inside the picture', async () => {
    // One circle 1.5 viewports above the current one, one inside it.
    const { outcome, deps } = await send([circle(-1000), circle(300)]);
    expect(deps.region).toBeDefined();
    expect(deps.region!.top).toBeLessThanOrEqual(-1000);
    expect(deps.region!.top + deps.region!.height).toBeGreaterThanOrEqual(360);
    expect(deps.region!.height).toBeLessThanOrEqual(3 * VH);
    // The viewport stays whole inside the taller picture.
    expect(deps.region!.top + deps.region!.height).toBeGreaterThanOrEqual(VH);
    expect(outcome.note).toBeUndefined();
    expect(outcome.screenshot).toEqual(screenshot);
  });

  it('drawings spanning more than three viewports are counted in the note', async () => {
    const { outcome, deps } = await send([circle(-4000), circle(300)]);
    expect(deps.region!.height).toBe(3 * VH);
    expect(outcome.note).toBe('1 drawing outside the picture');
    expect(outcome.annotations).toHaveLength(2);
  });

  it('a send without drawings keeps the viewport picture', async () => {
    const { outcome, deps } = await send([]);
    expect(deps.region).toBeUndefined();
    expect(outcome.note).toBeUndefined();
  });

  it('the count of drawings outside the picture is filed with the picture', async () => {
    const { outcome } = await send([circle(-4000), circle(300)]);
    expect(shotExtra(outcome)).toMatchObject({ note: '1 drawing outside the picture' });
    expect(shotExtra({ note: 'Screenshot not attached' })).toBeUndefined();
  });

  it('drawings inside the viewport keep the viewport picture though the marked element is taller', async () => {
    for (const el of [element(-500, 200), element(400, 1300), element(-900, 2000)]) {
      vi.mocked(grabViewport).mockClear();
      const { outcome, deps } = await send([circle(300)], el);
      expect(deps.region).toBeUndefined();
      expect(outcome.note).toBeUndefined();
    }
  });

  it('a drawing just above the viewport widens the picture without shrinking the viewport', async () => {
    const { deps } = await send([circle(-200)], element(-150, 100));
    expect(deps.region!.top).toBeLessThanOrEqual(-200);
    expect(deps.region!.top + deps.region!.height).toBeGreaterThanOrEqual(VH);
  });
});
