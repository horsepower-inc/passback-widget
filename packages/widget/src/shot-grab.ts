import { shotMaskRects } from '@passback/collectors/shot-mask';
import { encodeWithinCap } from './shot-encode';
import { frameScale, paintShot, type Frame } from './shot-paint';
import type { Shape } from './shot-shapes';

// The dev-server upload route takes PNG up to 2 MiB.
const LOCAL_MAX_BYTES = 2097152;

export type GrabFailure =
  | 'permission denied'
  | 'unsupported browser'
  | 'another window was shared'
  | 'image too large'
  | 'capture failed';
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
  frame?(stream: MediaStream): Promise<Frame>;
  makeCanvas?(width: number, height: number): HTMLCanvasElement;
  makePath?(d: string): Path2D;
  local?: boolean;
};

async function defaultFrame(win: Window, stream: MediaStream): Promise<Frame> {
  const video = win.document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
  return { source: video, width: video.videoWidth, height: video.videoHeight };
}

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
  return new Promise<Blob | null>((resolve) => target.toBlob(resolve, deps.local ? 'image/png' : 'image/webp', quality));
}

async function capture(deps: GrabDeps, stream: MediaStream): Promise<GrabResult> {
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if (surface !== undefined && surface !== 'browser') {
    return { ok: false, reason: 'another window was shared' };
  }
  const frame = await (deps.frame ? deps.frame(stream) : defaultFrame(deps.win, stream));
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

function stopTracks(stream: MediaStream | undefined): boolean {
  let failed = false;
  try {
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        failed = true;
      }
    }
  } catch {
    failed = true;
  }
  return failed;
}

function promptFailure(error: unknown): GrabResult {
  const name = (error as { name?: string } | null)?.name;
  return {
    ok: false,
    reason:
      name === 'NotAllowedError' || name === 'AbortError' ? 'permission denied' : 'capture failed',
  };
}

async function grab(deps: GrabDeps): Promise<GrabResult> {
  const media = deps.win.navigator.mediaDevices;
  if (typeof media?.getDisplayMedia !== 'function') {
    return { ok: false, reason: 'unsupported browser' };
  }
  const visibility = deps.host.style.visibility;
  let stream: MediaStream | undefined;
  let result: GrabResult = { ok: false, reason: 'capture failed' };
  let cleanupFailed = false;
  try {
    deps.host.style.visibility = 'hidden';
    try {
      stream = await media.getDisplayMedia({
        video: true,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
    } catch (error) {
      result = promptFailure(error);
    }
    if (stream) result = await capture(deps, stream);
  } finally {
    cleanupFailed = stopTracks(stream);
    deps.host.style.visibility = visibility;
  }
  return cleanupFailed ? { ok: false, reason: 'capture failed' } : result;
}

export async function grabViewport(deps: GrabDeps): Promise<GrabResult> {
  try {
    return await grab(deps);
  } catch {
    return { ok: false, reason: 'capture failed' };
  }
}
