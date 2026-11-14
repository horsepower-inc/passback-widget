import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';

export type RestCtx = {
  root: ShadowRoot;
  host: HTMLElement;
  launcher: { setVisible(visible: boolean): void };
  state: { flow: string; kept: { items: readonly unknown[] }; marks: readonly { id?: string }[] };
};

/** A little over the fly (420 ms) plus the stamp (1.8 s), so the Sent! pill and the stamp finish first. */
export const REST_MS = 2400;
const ATTRIBUTE = 'data-pb-panel';
const RULE = [CLASS.bubble, TRAY_CLASS.tray]
  .map((name) => `:host([${ATTRIBUTE}='rest']) .${name}`)
  .join(', ');

/** Collector-chunk add-on: after the last send is acknowledged the bubble and list hide, the dots stay. */
export function rest({ root, host, launcher, state }: RestCtx): void {
  const style = root.ownerDocument.createElement('style');
  style.setAttribute('data-pb-rest-styles', '');
  style.textContent = `${RULE} { display: none !important; }`;
  root.append(style);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = (): boolean =>
    host.getAttribute(ATTRIBUTE) === 'open' &&
    state.flow === 'idle' &&
    state.kept.items.length === 0 &&
    state.marks.length > 0 &&
    state.marks.every((mark) => mark.id !== undefined);
  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const sync = (): void => {
    if (!settled()) return stop();
    timer ??= setTimeout(() => {
      timer = undefined;
      if (!settled()) return;
      host.setAttribute(ATTRIBUTE, 'rest');
      launcher.setVisible(true);
    }, REST_MS);
  };
  const dispose = (): void => {
    stop();
    host.removeEventListener('passback:sync', sync);
    host.removeEventListener('passback:dispose', dispose);
    style.remove();
  };
  host.addEventListener('passback:sync', sync);
  host.addEventListener('passback:dispose', dispose);
}
