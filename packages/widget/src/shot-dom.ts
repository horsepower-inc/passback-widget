import { toCanvas } from 'html-to-image';
import type { Frame } from './shot-paint';

const RENDER_TIMEOUT_MS = 8000;
// One grey pixel stands in for an image that cannot be fetched.
const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

type Render = (node: HTMLElement, options: object) => Promise<HTMLCanvasElement>;
type Config = { shotEngine?: unknown; shotRender?: unknown };

const configOf = (win: Window): Config | undefined =>
  (win as unknown as { __passback?: Config }).__passback;

export async function renderFrame(win: Window, host: HTMLElement): Promise<Frame> {
  const override = configOf(win)?.shotRender;
  const render: Render = typeof override === 'function' ? (override as Render) : toCanvas;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('shot render timed out')), RENDER_TIMEOUT_MS);
  });
  try {
    const canvas = await Promise.race([
      render(win.document.documentElement, {
        width: win.innerWidth,
        height: win.innerHeight,
        pixelRatio: 1,
        cacheBust: false,
        style: {
          transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`,
          transformOrigin: '0 0',
        },
        filter: (node: Node) => node !== host,
        imagePlaceholder: PLACEHOLDER,
      }),
      timeout,
    ]);
    return { source: canvas, width: canvas.width, height: canvas.height };
  } finally {
    clearTimeout(timer);
  }
}
