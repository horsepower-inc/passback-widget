import { shotMaskRects } from '@passback/collectors/shot-mask';
import { renderFrame } from './shot-dom';
import { encodeWithinCap } from './shot-encode';
import { colorsOf, frameScale, paintShot, type Frame, type ShotMark } from './shot-paint';
import type { Shape } from './shot-shapes';

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
  render?(win: Window, host: HTMLElement): Promise<Frame>;
  makeCanvas?(width: number, height: number): HTMLCanvasElement;
  makePath?(d: string): Path2D;
  local?: boolean;
};

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

async function paintAndEncode(deps: GrabDeps, frame: Frame): Promise<GrabResult> {
  const k = frameScale(frame);
  const canvas = canvasFor(deps, Math.round(frame.width * k), Math.round(frame.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'capture failed' };
  const { win, host } = deps;
  const masks = shotMaskRects(
    win.document,
    { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight },
    host,
  );
  paintShot(ctx, {
    marks: deps.marks,
    colors: colorsOf(win, host),
    frame,
    size: canvas,
    cssWidth: win.innerWidth,
    masks,
    shapes: deps.shapes,
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

export async function grabViewport(deps: GrabDeps): Promise<GrabResult> {
  try {
    return await paintAndEncode(deps, await (deps.render ?? renderFrame)(deps.win, deps.host));
  } catch {
    return { ok: false, reason: 'capture failed' };
  }
}
