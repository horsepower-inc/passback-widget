// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInk, type Ink } from './shot-ink';
import { mountVeil } from './shot-veil';
import { mountTools } from './shot-tools';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import type { Shape } from './shot-shapes';
import { openShot } from './shot';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-veil', () => ({ mountVeil: vi.fn() }));
vi.mock('./shot-tools', () => ({ mountTools: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

const shape: Shape = { tool: 'arrow', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } };
// document.body measures 0,0 in happy-dom, so the offsets equal the viewport points.
const arrow0 = { type: 'arrow', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } };
const captured = {
  ok: true as const, blob: new Blob(['picture']), mime: 'image/webp' as const,
  width: 800, height: 600, masked: 2,
};
const screenshot = {
  id: 'a'.repeat(32), mime: captured.mime, width: 800, height: 600, masked: 2, bytes: 7,
};
let shapes: readonly Shape[];
let ink: Ink;
let change: (count: number) => void;
const veil = { refresh: vi.fn(), destroy: vi.fn() };
const tools = { element: document.createElement('div'), setCount: vi.fn(), destroy: vi.fn() };

function markedElement(): Element {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  return element;
}

function setup() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const options = { win: window, root, host, uploadUrl: '/screenshots', fetchFn: vi.fn<typeof fetch>() };
  return { options, session: openShot(options) };
}

beforeEach(() => {
  vi.resetAllMocks();
  shapes = [];
  ink = {
    tool: 'arrow', shapes: () => shapes, setActive: vi.fn(), destroy: vi.fn(),
    undo: vi.fn(() => { shapes = shapes.slice(0, -1); change(shapes.length); }),
    clear: vi.fn(() => { shapes = []; change(0); }),
  };
  vi.mocked(mountInk).mockImplementation((_root, _win, onChange) => {
    change = onChange;
    onChange(0);
    return ink;
  });
  vi.mocked(mountVeil).mockReturnValue(veil);
  vi.mocked(mountTools).mockReturnValue(tools);
  vi.mocked(grabViewport).mockResolvedValue(captured);
  vi.mocked(uploadShot).mockResolvedValue({ ok: true, screenshot });
});

describe('shot session', () => {
  it('mounts the drawing layer, the covers and the tool buttons when a session opens', () => {
    const { options, session } = setup();
    expect(mountInk).toHaveBeenCalledWith(options.root, window, expect.any(Function));
    expect(ink.setActive).toHaveBeenCalledWith(true);
    expect(mountVeil).toHaveBeenCalledWith(options.root, window, options.host);
    expect(mountTools).toHaveBeenCalledWith(options.root, expect.objectContaining({ side: 'right', tool: 'arrow' }));
    expect(tools.setCount).toHaveBeenCalledWith(0);
    session.setActive(true);
    expect(mountTools).toHaveBeenCalledTimes(1);
    expect(mountVeil).toHaveBeenCalledTimes(1);
    expect(ink.setActive).toHaveBeenCalledTimes(1);
  });

  it('connects the tool buttons to the drawing layer and keeps their count current', () => {
    const { session } = setup();
    const callbacks = vi.mocked(mountTools).mock.calls[0]![1];
    callbacks.onTool('box');
    expect(ink.tool).toBe('box');
    shapes = [shape, shape];
    change(2);
    expect(session.count()).toBe(2);
    expect(tools.setCount).toHaveBeenLastCalledWith(2);
    callbacks.onUndo();
    expect(ink.undo).toHaveBeenCalledOnce();
    expect(tools.setCount).toHaveBeenLastCalledWith(1);
    callbacks.onClear();
    expect(ink.clear).toHaveBeenCalledOnce();
    expect(tools.setCount).toHaveBeenLastCalledWith(0);
  });

  it('pauses drawing by removing the covers and the tool buttons and keeps the shapes', () => {
    const { session } = setup();
    shapes = [shape];
    session.setActive(false);
    session.setActive(false);
    expect(ink.setActive).toHaveBeenLastCalledWith(false);
    expect(ink.setActive).toHaveBeenCalledTimes(2);
    expect(veil.destroy).toHaveBeenCalledOnce();
    expect(tools.destroy).toHaveBeenCalledOnce();
    expect(ink.destroy).not.toHaveBeenCalled();
    expect(session.count()).toBe(1);
    change(1);
    expect(tools.setCount).toHaveBeenCalledTimes(1);
    session.setActive(true);
    expect(mountTools).toHaveBeenCalledTimes(2);
    expect(mountVeil).toHaveBeenCalledTimes(2);
    expect(tools.setCount).toHaveBeenLastCalledWith(1);
  });

  it('resolves an empty outcome and captures nothing when nothing was drawn', async () => {
    const { session } = setup();
    await expect(session.finish(document.body)).resolves.toEqual({});
    expect(grabViewport).not.toHaveBeenCalled();
    expect(uploadShot).not.toHaveBeenCalled();
  });

  it('captures with the drawn shapes, uploads and resolves the screenshot metadata', async () => {
    const { options, session } = setup();
    shapes = [shape];
    await expect(session.finish(document.body)).resolves.toEqual({ screenshot, annotations: [arrow0] });
    expect(grabViewport).toHaveBeenCalledWith({ win: window, host: options.host, shapes });
    expect(uploadShot).toHaveBeenCalledWith({
      url: options.uploadUrl, blob: captured.blob, mime: captured.mime,
      width: 800, height: 600, masked: 2, fetchFn: options.fetchFn,
    });
    session.close();
    expect(session.count()).toBe(0);
  });

  it('local: finish asks the grab for a png and uploads to the local url', async () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const png = { ...captured, mime: 'image/png' as const };
    vi.mocked(grabViewport).mockResolvedValueOnce(png);
    vi.mocked(uploadShot).mockResolvedValueOnce({ ok: true, screenshot: { ...screenshot, mime: 'image/png' } });
    const session = openShot({ win: window, root, host, uploadUrl: '/__passback/screenshot', local: true });
    shapes = [shape];
    await expect(session.finish(document.body)).resolves.toEqual({
      screenshot: { ...screenshot, mime: 'image/png' }, annotations: [arrow0],
    });
    expect(grabViewport).toHaveBeenCalledExactlyOnceWith({ win: window, host, shapes, local: true });
    expect(uploadShot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: '/__passback/screenshot', blob: png.blob, mime: 'image/png',
    }));
  });

  it('resolves a Screenshot not attached note when the capture fails', async () => {
    const { session } = setup();
    shapes = [shape];
    vi.mocked(grabViewport).mockResolvedValueOnce({ ok: false, reason: 'permission denied' });
    await expect(session.finish(document.body)).resolves.toEqual({ note: 'Screenshot not attached', annotations: [arrow0] });
    expect(uploadShot).not.toHaveBeenCalled();
    vi.mocked(grabViewport).mockRejectedValueOnce(new Error('unexpected'));
    await expect(session.finish(document.body)).resolves.toEqual({ note: 'Screenshot not attached', annotations: [arrow0] });
    vi.spyOn(ink, 'shapes').mockImplementationOnce(() => { throw new Error('unexpected'); });
    await expect(session.finish(document.body)).resolves.toEqual({ note: 'Screenshot not attached' });
  });

  it('resolves a Screenshot not attached note when the upload is refused', async () => {
    const { session } = setup();
    shapes = [shape];
    vi.mocked(uploadShot).mockResolvedValueOnce({ ok: false, message: 'HTTP 403' });
    await expect(session.finish(document.body)).resolves.toEqual({ note: 'Screenshot not attached', annotations: [arrow0] });
    vi.mocked(uploadShot).mockRejectedValueOnce(new Error('unexpected'));
    await expect(session.finish(document.body)).resolves.toEqual({ note: 'Screenshot not attached', annotations: [arrow0] });
  });

  it('resolves the Premium note when the upload is refused with plan_required', async () => {
    const { session } = setup();
    shapes = [shape];
    vi.mocked(uploadShot).mockResolvedValueOnce({ ok: false, message: 'HTTP 403', code: 'plan_required' });
    const outcome = await session.finish(document.body);
    expect(outcome.note).toBe('Screenshot not attached: pictures come with Premium.');
    expect(outcome.screenshot).toBeUndefined();
  });

  it('returns the drawn arrows and boxes as annotations relative to the marked element with the screenshot', async () => {
    const { session } = setup();
    const box: Shape = { tool: 'box', from: { x: 15, y: 25 }, to: { x: 55, y: 65 } };
    shapes = [shape, box];
    await expect(session.finish(markedElement())).resolves.toEqual({
      screenshot,
      annotations: [
        { type: 'arrow', from: { x: -9, y: -18 }, to: { x: 20, y: 20 } },
        { type: 'box', from: { x: 5, y: 5 }, to: { x: 45, y: 45 } },
      ],
    });
  });

  it('returns the annotations next to the note when the picture could not be attached', async () => {
    const { session } = setup();
    shapes = [shape];
    const annotations = [{ type: 'arrow', from: { x: -9, y: -18 }, to: { x: 20, y: 20 } }];
    vi.mocked(grabViewport).mockResolvedValueOnce({ ok: false, reason: 'permission denied' });
    await expect(session.finish(markedElement())).resolves.toEqual({ note: 'Screenshot not attached', annotations });
    vi.mocked(uploadShot).mockResolvedValueOnce({ ok: false, message: 'HTTP 403' });
    await expect(session.finish(markedElement())).resolves.toEqual({ note: 'Screenshot not attached', annotations });
  });

  it('returns no annotations key when only lines were drawn', async () => {
    const { session } = setup();
    shapes = [{ tool: 'line', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } as Shape];
    const outcome = await session.finish(markedElement());
    expect(outcome).toEqual({ screenshot });
    expect(Object.keys(outcome)).toEqual(['screenshot']);
  });

  it('removes everything on close, also when called twice', () => {
    const { session } = setup();
    shapes = [shape];
    session.close();
    session.close();
    expect(ink.destroy).toHaveBeenCalledOnce();
    expect(veil.destroy).toHaveBeenCalledOnce();
    expect(tools.destroy).toHaveBeenCalledOnce();
    expect(session.count()).toBe(0);
    session.setActive(true);
    expect(mountTools).toHaveBeenCalledTimes(1);
    const paused = setup().session;
    paused.setActive(false);
    paused.close();
    expect(veil.destroy).toHaveBeenCalledTimes(2);
    expect(tools.destroy).toHaveBeenCalledTimes(2);
  });

  it('registers itself as __passback.shot', () => {
    const scope = globalThis as { __passback?: Record<string, unknown> };
    expect(scope.__passback?.shot).toBe(openShot);
  });

  it('R2 opens paused, mounts its buttons into the palette toolbar and activates on demand', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const bar = root.appendChild(document.createElement('div'));
    bar.dataset.role = 'tools';
    bar.dataset.shape = 'box';
    const session = openShot({ win: window, root, host, uploadUrl: '/screenshots', active: false });
    expect(ink.setActive).toHaveBeenCalledExactlyOnceWith(false);
    expect(mountVeil).not.toHaveBeenCalled();
    expect(mountTools).toHaveBeenCalledExactlyOnceWith(root, expect.objectContaining({ parent: bar, tool: 'box' }));
    expect(ink.tool).toBe('box');
    session.setActive(true);
    expect(ink.setActive).toHaveBeenLastCalledWith(true);
    expect(mountVeil).toHaveBeenCalledOnce();
    expect(mountTools).toHaveBeenCalledOnce();
    session.setActive(false);
    expect(veil.destroy).toHaveBeenCalledOnce();
    expect(tools.destroy).not.toHaveBeenCalled();
    session.close();
    expect(tools.destroy).toHaveBeenCalledOnce();
    expect(ink.destroy).toHaveBeenCalledOnce();
  });
});
