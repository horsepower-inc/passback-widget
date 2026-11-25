import { CLASS } from './styles';
import { formatClock, startRecording, VOICE_MAX_MS, type Recording } from './voice-record';
import { voiceMicStyles } from './voice-mic-styles';
import { probeVoice, uploadVoice, voiceUrlOf, type VoiceCode } from './voice-upload';

type Ctx = { root: ShadowRoot; host: HTMLElement; doc: Document };
type Deps = {
  probe?: typeof probeVoice;
  record?: typeof startRecording;
  upload?: typeof uploadVoice;
};
type Io = { doc: Document; url: string } & Required<Omit<Deps, 'probe'>>;

const MIC =
  'M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5ZM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5';
const BARS = 12;
// One probe per page load, shared by every box and every overlay the page builds.
const probes = new Map<string, Promise<boolean>>();
const TYPE = ' Type the comment instead.';
const FAILED = `Could not turn the recording into text.${TYPE}`;
const LIMIT = `Recording stopped at the ${formatClock(VOICE_MAX_MS)} limit.`;
const REFUSALS: Record<VoiceCode | 'denied', string> = {
  plan_required: 'Voice comments come with Premium.',
  voice_unavailable: 'Voice is not available on this site right now.',
  no_speech: 'No words were heard. Try again or type.',
  too_large: FAILED,
  failed: FAILED,
  denied: `Microphone access was refused.${TYPE}`,
};

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  role?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (role) node.dataset.role = role;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fragment(doc: Document, html: string): DocumentFragment {
  return doc.createRange().createContextualFragment(html);
}

function button(doc: Document, role: string, label: string): HTMLButtonElement {
  const b = el(doc, 'button', role, label);
  b.type = 'button';
  return b;
}

function micButton(doc: Document): HTMLButtonElement {
  const b = button(doc, 'voice', '');
  b.className = CLASS.ico;
  b.setAttribute('aria-label', 'Record a voice comment');
  b.append(
    fragment(
      doc,
      `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${MIC}" fill="none" stroke="currentColor"/></svg>`,
    ),
  );
  return b;
}

// Returns the teardown that stops any live or pending recording when the box goes away.
function attach(io: Io, textarea: HTMLTextAreaElement, bar: HTMLElement): () => void {
  const { doc, url, record, upload } = io;
  const mic = micButton(doc);
  bar.insertBefore(mic, bar.querySelector(`.${CLASS.actions}`));
  let rec: Recording | undefined;
  let pending = false;
  let gone = false;
  let frame: HTMLElement | undefined;
  let hidden: HTMLElement[] = [];
  const clear = (role: string) =>
    textarea.parentElement?.querySelector(`[data-role="${role}"]`)?.remove();
  const note = (text: string): void => {
    clear('voice-note');
    const p = el(doc, 'p', 'voice-note', text);
    p.className = CLASS.note;
    textarea.before(p);
  };
  const restore = (): void => {
    frame?.remove();
    frame = undefined;
    for (const child of hidden) child.hidden = false;
    hidden = [];
    doc.removeEventListener('keydown', onKey, true);
    rec = undefined;
  };
  const cancel = (): void => {
    rec?.cancel();
    restore();
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') cancel();
  }
  const finish = async (
    active: Recording,
    controls: HTMLButtonElement[],
    clock: HTMLElement,
    limit = false,
  ) => {
    for (const c of controls) c.disabled = true;
    clock.textContent = 'Transcribing';
    const { blob, ms } = await active.stop();
    const result = await upload({ url, blob, mime: active.mime });
    if (rec !== active) return;
    restore();
    if (!result.ok)
      return note(limit ? `${LIMIT} ${REFUSALS[result.code]}` : REFUSALS[result.code]);
    if (limit) note(LIMIT);
    textarea.value = textarea.value ? `${textarea.value} ${result.text}` : result.text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    clear('voice-chip');
    textarea.before(el(doc, 'span', 'voice-chip', `Voice ${formatClock(ms)}`));
  };
  const begin = async (): Promise<void> => {
    if (rec || pending || gone || textarea.disabled) return;
    pending = true;
    mic.disabled = true;
    clear('voice-note');
    const dot = el(doc, 'span', 'voice-dot');
    const clock = el(doc, 'span', 'voice-clock', formatClock(0));
    const bars = el(doc, 'span', 'voice-bars');
    const cells = Array.from({ length: BARS }, () => bars.appendChild(el(doc, 'i')));
    let tail = 0;
    const level = (v: number): void => {
      cells[tail++ % BARS]!.style.height = `${Math.round(2 + Math.min(1, Math.max(0, v)) * 14)}px`;
    };
    const onTick = (ms: number): void => void (clock.textContent = formatClock(ms));
    let onLimit = (): void => {};
    const started = await record({ onTick, onLevel: level, onLimit: () => onLimit() }).catch(
      (e: Error) => `${e?.message}`,
    );
    pending = false;
    mic.disabled = false;
    if (typeof started === 'string') {
      if (started === 'unsupported') mic.hidden = true;
      else if (!gone) note(REFUSALS[started === 'denied' ? 'denied' : 'failed']);
      return;
    }
    if (gone) return started.cancel();
    rec = started;
    const stop = button(doc, 'voice-stop', 'Stop');
    const quit = button(doc, 'voice-cancel', 'Cancel');
    frame = el(doc, 'div', 'voice-frame');
    frame.append(dot, clock, bars, quit, stop);
    hidden = [...bar.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    for (const child of hidden) child.hidden = true;
    bar.appendChild(frame);
    quit.addEventListener('click', cancel);
    stop.addEventListener('click', () => void finish(started, [stop, quit], clock));
    // Only the live recording finishes at the limit, and only when Stop has not already finished it.
    onLimit = () =>
      void (rec === started && !stop.disabled && finish(started, [stop, quit], clock, true));
    doc.addEventListener('keydown', onKey, true);
  };
  mic.addEventListener('click', () => void begin());
  return () => {
    gone = true;
    cancel();
  };
}

/** Collector-chunk add-on: a mic in the hosted comment box that turns a spoken comment into text. */
export async function voiceMic(ctx: Ctx, deps: Deps = {}): Promise<void> {
  const { root, host, doc } = ctx;
  const win = doc.defaultView as (Window & { __passback?: { hot?: unknown } }) | null;
  if (!win || win.__passback?.hot) return;
  const endpoint = doc
    .querySelector('script[data-passback-endpoint]')
    ?.getAttribute('data-passback-endpoint');
  if (!endpoint) return;
  const url = voiceUrlOf(endpoint);
  let disposed = false;
  const observer = new MutationObserver(() => scan());
  const boxes = new Map<HTMLTextAreaElement, () => void>();
  const dispose = (): void => {
    disposed = true;
    observer.disconnect();
    for (const teardown of boxes.values()) teardown();
    boxes.clear();
  };
  host.addEventListener('passback:dispose', dispose, { once: true });
  let answer = probes.get(url);
  if (!answer) probes.set(url, (answer = (deps.probe ?? probeVoice)(url)));
  if (!(await answer) || disposed) return;

  const record = deps.record ?? startRecording;
  const upload = deps.upload ?? uploadVoice;
  root.appendChild(fragment(doc, `<style data-pb-voice-styles>${voiceMicStyles()}</style>`));

  const scan = (): void => {
    for (const [textarea, teardown] of boxes) {
      if (textarea.isConnected) continue;
      teardown();
      boxes.delete(textarea);
    }
    for (const textarea of root.querySelectorAll<HTMLTextAreaElement>(`textarea.${CLASS.input}`)) {
      const bar = textarea.nextElementSibling;
      if (!(bar instanceof HTMLElement) || !bar.classList.contains(CLASS.bar)) continue;
      if (!bar.querySelector('[data-role="voice"]'))
        boxes.set(textarea, attach({ doc, url, record, upload }, textarea, bar));
    }
  };
  observer.observe(root, { childList: true, subtree: true });
  scan();
}
