// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInk } from './shot-ink';
import { mountVeil } from './shot-veil';
import { mountTools } from './shot-tools';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import { openShot } from './shot';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-veil', () => ({ mountVeil: vi.fn() }));
vi.mock('./shot-tools', () => ({ mountTools: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

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

function setup() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const options = {
    win: window,
    root,
    host,
    uploadUrl: '/screenshots',
    fetchFn: vi.fn<typeof fetch>(),
  };
  const element = document.createElement('div');
  document.body.append(element);
  element.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 50, right: 110, bottom: 70 }) as DOMRect;
  return { options, element, session: openShot(options) };
}

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
  vi.mocked(mountInk).mockReturnValue({
    tool: 'arrow',
    shapes: () => [],
    setActive: vi.fn(),
    destroy: vi.fn(),
    undo: vi.fn(),
    clear: vi.fn(),
  });
  vi.mocked(mountVeil).mockReturnValue({ refresh: vi.fn(), destroy: vi.fn() });
  vi.mocked(mountTools).mockReturnValue({
    element: document.createElement('div'),
    setCount: vi.fn(),
    destroy: vi.fn(),
  });
  vi.mocked(grabViewport).mockResolvedValue(captured);
  vi.mocked(uploadShot).mockResolvedValue({ ok: true, screenshot });
});

describe('shot pins', () => {
  it('captures and uploads when nothing was drawn, with the pinned mark and no annotations', async () => {
    const { session, element } = setup();
    const outcome = await session.finish(element, {
      comment: 'c',
      selector: 's',
      offset: { x: 5, y: 6 },
      element,
    });
    expect(outcome).toEqual({ screenshot });
    expect(outcome).not.toHaveProperty('annotations');
    expect(grabViewport).toHaveBeenCalledTimes(1);
    expect(uploadShot).toHaveBeenCalledTimes(1);
  });

  it('hands the marks of the submit detail to the grab', async () => {
    const { session, element } = setup();
    await session.finish(element, { comment: 'c', selector: 's', offset: { x: 5, y: 6 }, element });
    expect(vi.mocked(grabViewport).mock.calls[0]![0].marks).toEqual([
      {
        rect: { x: 10, y: 20, width: 100, height: 50 },
        point: { x: 15, y: 26 },
        n: 1,
        current: true,
      },
    ]);
  });

  it('paints every mark of a Send all with its own number and the sent one current', async () => {
    const { session, element } = setup();
    const rectOf = (left: number) => () =>
      ({ left, top: 20, width: 100, height: 50, right: left + 100, bottom: 70 }) as DOMRect;
    const other = document.body.appendChild(document.createElement('div'));
    other.getBoundingClientRect = rectOf(200);
    const marks = [
      { element, offset: { x: 5, y: 6 }, n: 1, current: false },
      { element, offset: { x: 7, y: 8 }, n: 2, current: true },
      { element: other, offset: { x: 1, y: 2 }, n: 3, current: false },
    ];
    await session.finish(element, {
      comment: 'c',
      selector: 's',
      offset: { x: 7, y: 8 },
      element,
      marks,
    });
    const painted = vi.mocked(grabViewport).mock.calls[0]![0].marks!;
    expect(painted.map(({ n, current }) => [n, current])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect(painted[2]!.rect.x).toBe(200);
  });
});
