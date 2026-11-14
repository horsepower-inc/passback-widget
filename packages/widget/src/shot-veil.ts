import { shotMaskRects } from '@passback/collectors/shot-mask';

export type Veil = { refresh(): void; destroy(): void };

export function mountVeil(root: ShadowRoot, win: Window, host: Element): Veil {
  const container = win.document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.dataset.role = 'veil';
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none';
  root.prepend(container);
  let frame: number | undefined;

  const refresh = (): void => {
    const boxes = shotMaskRects(
      win.document,
      { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight },
      host,
    );
    container.replaceChildren(
      ...boxes.map(({ x, y, width, height }) => {
        const box = win.document.createElement('div');
        box.style.cssText = `position:absolute;background:#000;left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
        return box;
      }),
    );
  };
  const schedule = (): void => {
    if (frame !== undefined) return;
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      refresh();
    });
  };
  refresh();
  win.addEventListener('scroll', schedule, { capture: true, passive: true });
  win.addEventListener('resize', schedule);

  return {
    refresh,
    destroy(): void {
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      frame = undefined;
      container.remove();
    },
  };
}
