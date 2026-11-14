import { buttonNode, textNode } from './review-view';
import type { Frame } from './shot-paint';

const NOTE = 'Page capture failed. Capture this tab to attach a picture.';
const CHOOSE = 'Choose this tab in the picker to attach a picture.';

// The canvas comes from the caller, which owns the screenshot's canvases.
export type Display = { makeCanvas(width: number, height: number): HTMLCanvasElement };

type Owner = { mark: HTMLElement; signal: AbortSignal; alive(): boolean; settle(): void };

const supported = (win: Window): boolean =>
  typeof win.navigator.mediaDevices?.getDisplayMedia === 'function';

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

// Rejects as soon as the owner goes away, so that no wait outlives it.
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abandon = (): void => reject(new Error('capture abandoned'));
    if (signal.aborted) return abandon();
    signal.addEventListener('abort', abandon, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abandon));
  });
}

// One decoded frame of the stream, copied out so that the tracks can stop before it is painted.
async function snapshot(
  win: Window,
  stream: MediaStream,
  signal: AbortSignal,
  opts: Display,
): Promise<Frame> {
  const video = win.document.createElement('video');
  try {
    video.muted = true;
    video.srcObject = stream;
    await until(video.play(), signal);
    for (let i = 0; i < 2; i++)
      await until(
        new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve())),
        signal,
      );
    const { videoWidth: width, videoHeight: height } = video;
    if (!(width > 0 && height > 0)) throw new Error('empty frame');
    const canvas = opts.makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Missing canvas context');
    ctx.drawImage(video, 0, 0, width, height);
    return { source: canvas, width, height };
  } finally {
    video.srcObject = null;
  }
}

// The person may stop sharing at any time: that ends the wait, however far the frame got.
async function frameOf(
  win: Window,
  stream: MediaStream,
  signal: AbortSignal,
  opts: Display,
): Promise<Frame> {
  const tracks = stream.getVideoTracks();
  const inner = new AbortController();
  const stopWaiting = (): void => inner.abort();
  signal.addEventListener('abort', stopWaiting, { once: true });
  for (const track of tracks) track.addEventListener('ended', stopWaiting, { once: true });
  try {
    if (tracks.some((track) => track.readyState === 'ended')) throw new Error('capture ended');
    return await snapshot(win, stream, inner.signal, opts);
  } finally {
    signal.removeEventListener('abort', stopWaiting);
    for (const track of tracks) track.removeEventListener('ended', stopWaiting);
  }
}

// Asks for the current tab and takes one frame. The request is made before the first await, so it
// belongs to the activation of the caller. The widget is hidden while the frame is taken, every
// track stops, and a stream that arrives after the owner went away is stopped on arrival.
async function captureTab(
  win: Window,
  host: HTMLElement,
  signal: AbortSignal,
  opts: Display,
): Promise<Frame> {
  const visibility = host.style.visibility;
  let request: Promise<MediaStream> | undefined;
  let stream: MediaStream | undefined;
  let frame: Frame | undefined;
  let cleanupFailed: boolean;
  try {
    request = win.navigator.mediaDevices.getDisplayMedia({
      video: true,
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
    stream = await until(request, signal);
    host.style.visibility = 'hidden';
    // Only an explicitly reported window or monitor is refused: the tab itself cannot be told.
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    if (surface !== undefined && surface !== 'browser')
      throw new Error('another window was shared');
    frame = await frameOf(win, stream, signal, opts);
  } finally {
    if (!stream) request?.then(stopTracks, () => undefined);
    cleanupFailed = stopTracks(stream);
    host.style.visibility = visibility;
  }
  if (cleanupFailed || !frame) throw new Error('capture failed');
  return frame;
}

const sendingMark = (host: HTMLElement): HTMLElement | undefined => {
  const marks = host.shadowRoot?.querySelectorAll<HTMLElement>('.pb-bubble[data-state="sending"]');
  return marks?.[marks.length - 1];
};

// Shows the nodes in the sending mark. Aborts when the mark leaves the sending state, when the
// mark, the host or one of the nodes is removed, and when settled; the nodes go with it.
function own(win: Window, host: HTMLElement, nodes: HTMLElement[]): Owner | undefined {
  const mark = sendingMark(host);
  const root = host.shadowRoot;
  if (!mark || !root) return undefined;
  const control = new AbortController();
  const { signal } = control;
  const hidden = mark.hidden;
  const alive = (): boolean =>
    !signal.aborted &&
    host.isConnected &&
    mark.isConnected &&
    mark.getAttribute('data-state') === 'sending' &&
    nodes.every((node) => node.parentNode === mark);
  const watch = new (win as Window & typeof globalThis).MutationObserver(() => {
    if (!alive()) settle();
  });
  const settle = (): void => {
    if (signal.aborted) return;
    control.abort();
    watch.disconnect();
    for (const node of nodes) node.remove();
    mark.hidden = hidden;
  };
  mark.hidden = false;
  mark.append(...nodes);
  watch.observe(root, { childList: true, subtree: true });
  watch.observe(mark.ownerDocument, { childList: true, subtree: true });
  watch.observe(mark, { attributes: true, attributeFilter: ['data-state'] });
  return { mark, signal, alive, settle };
}

// Opens the picker at once, within the activation of the caller, and tells the person in the
// sending mark to choose this tab. Rejects at once without support or a live mark.
export function captureNow(win: Window, host: HTMLElement, opts: Display): Promise<Frame> {
  if (!supported(win)) return Promise.reject(new Error('unsupported browser'));
  const owner = own(win, host, [textNode(host.ownerDocument, 'p', 'pb-note', CHOOSE)]);
  if (!owner) return Promise.reject(new Error('no sending mark'));
  return captureTab(win, host, owner.signal, opts).finally(owner.settle);
}

// Shows the button in the sending mark and keeps the promise pending until the person acts.
// Rejects at once without support or a live mark, and when the owner goes away.
export function offerCapture(win: Window, host: HTMLElement, opts: Display): Promise<Frame> {
  if (!supported(win)) return Promise.reject(new Error('unsupported browser'));
  const doc = host.ownerDocument;
  let click = (): void => undefined;
  const onClick = (): void => click();
  const button = buttonNode(doc, 'pb-send', 'Capture screen', 'capture-screen', onClick);
  button.dataset.role = 'capture-screen';
  const owner = own(win, host, [textNode(doc, 'p', 'pb-note', NOTE), button]);
  if (!owner) return Promise.reject(new Error('no sending mark'));
  const { signal } = owner;
  return new Promise<Frame>((resolve, reject) => {
    let asked = false;
    // A second click, or a click on a button that left its mark, asks nothing.
    click = (): void => {
      if (asked || !owner.alive() || button.parentNode !== owner.mark) return;
      asked = true;
      button.disabled = true;
      captureTab(win, host, signal, opts).then(resolve, reject);
    };
    signal.addEventListener(
      'abort',
      () => {
        button.removeEventListener('click', onClick);
        reject(new Error('capture abandoned'));
      },
      { once: true },
    );
  }).finally(owner.settle);
}
