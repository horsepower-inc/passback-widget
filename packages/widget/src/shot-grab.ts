import { shotMaskRects } from '@passback/collectors/shot-mask';
import { overBudget, renderFrame, slicesOf, viewOf, type View } from './shot-dom';
import { captureNow, offerCapture, type Display } from './shot-display';
import { encodeWithinCap } from './shot-encode';
import { colorsOf, frameScale, paintShot, type Frame, type ShotMark } from './shot-paint';
import { shiftShapes, type Shape } from './shot-shapes';

// The dev-server upload route takes PNG up to 2 MiB.
const LOCAL_MAX_BYTES = 2097152;

export type GrabFailure = 'image too large' | 'capture failed';
export type GrabResult =
  | {
      ok: true;
      blob: Blob;
      mime: 'image/webp' | 'image/png';
      width: number;
      height: number;
      masked: number;
    }
  | { ok: false; reason: GrabFailure };
export type GrabDeps = {
  win: Window;
  host: HTMLElement;
  shapes: readonly Shape[];
  marks?: readonly ShotMark[];
  // The band of the page to picture, in viewport coordinates; the viewport when absent.
  region?: View;
  render?(win: Window, host: HTMLElement, view: View): Promise<Frame>;
  overBudget?(win: Window, host: HTMLElement, view: View): boolean;
  makeCanvas?(width: number, height: number): HTMLCanvasElement;
  makePath?(d: string): Path2D;
  local?: boolean;
};

const liftMark = (m: ShotMark, top: number): ShotMark => ({
  ...m,
  rect: { ...m.rect, y: m.rect.y - top },
  point: { x: m.point.x, y: m.point.y - top },
});

function canvasFor(deps: GrabDeps, width: number, height: number): HTMLCanvasElement {
  if (deps.makeCanvas) return deps.makeCanvas(width, height);
  const canvas = deps.win.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encodeCanvas(deps: GrabDeps, canvas: HTMLCanvasElement, quality: number, scale: number) {
  let target = canvas;
  if (scale !== 1) {
    target = canvasFor(deps, Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    const ctx = target.getContext('2d');
    if (!ctx) throw new Error('Missing canvas context');
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
  }
  return new Promise<Blob | null>((resolve) =>
    target.toBlob(resolve, deps.local ? 'image/png' : 'image/webp', quality),
  );
}

async function paintAndEncode(deps: GrabDeps, frame: Frame, view: View): Promise<GrabResult> {
  const k = frameScale(frame);
  const canvas = canvasFor(deps, Math.round(frame.width * k), Math.round(frame.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'capture failed' };
  const { win, host } = deps;
  const masks = shotMaskRects(
    win.document,
    { x: 0, y: view.top, width: win.innerWidth, height: view.height },
    host,
  );
  paintShot(ctx, {
    marks: view.top ? deps.marks?.map((m) => liftMark(m, view.top)) : deps.marks,
    colors: colorsOf(win, host),
    frame,
    size: canvas,
    cssWidth: win.innerWidth,
    masks,
    shapes: view.top ? shiftShapes(deps.shapes, 0, -view.top) : deps.shapes,
    makePath: deps.makePath,
  });
  const encoded = await encodeWithinCap(
    (quality, scale) => encodeCanvas(deps, canvas, quality, scale),
    deps.local ? LOCAL_MAX_BYTES : undefined,
  );
  if (!encoded) return { ok: false, reason: 'image too large' };
  return {
    ok: true,
    blob: encoded.blob,
    mime: encoded.mime,
    width: Math.round(canvas.width * encoded.scale),
    height: Math.round(canvas.height * encoded.scale),
    masked: masks.length,
  };
}

const activated = (win: Window): boolean =>
  (win.navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;

function refused(deps: GrabDeps, view: View): boolean {
  try {
    // Each slice is rendered on its own, so the budget holds per slice, not for the whole band.
    const check = deps.overBudget ?? overBudget;
    return slicesOf(view).some((slice) => check(deps.win, deps.host, slice));
  } catch {
    return false;
  }
}

const display = (deps: GrabDeps): Display => ({
  makeCanvas: (width, height) => canvasFor(deps, width, height),
});

// The DOM render is the default. Only a refused budget or a render that rejected or timed out
// reaches the browser capture: at once while the Send activation lasts, else on a click. The
// browser capture is the viewport, so it comes back with the viewport as its band.
async function frameOf(deps: GrabDeps): Promise<[Frame, View]> {
  const { win, host } = deps;
  const view = deps.region ?? viewOf(win);
  const whole = viewOf(win);
  const shown = (frame: Frame): [Frame, View] => [frame, whole];
  const over = refused(deps, view);
  if (over && activated(win)) return shown(await captureNow(win, host, display(deps)));
  const recover = async (): Promise<[Frame, View]> =>
    shown(await offerCapture(win, host, display(deps)));
  if (over) return recover();
  const render = deps.render ?? ((w, h, v) => renderFrame(w, h, v, deps.makeCanvas));
  return render(win, host, view)
    .then((frame): [Frame, View] => [frame, view])
    .catch(recover);
}

export async function grabViewport(deps: GrabDeps): Promise<GrabResult> {
  try {
    const [frame, view] = await frameOf(deps);
    return await paintAndEncode(deps, frame, view);
  } catch {
    return { ok: false, reason: 'capture failed' };
  }
}
