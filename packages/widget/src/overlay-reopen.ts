import type { Status } from './bubble-view';
import type { TrackedMark } from './overlay-reattach';
import type { ReopenPort } from './reopen';
import { appendStillWrong, renderReopenBox } from './reply-box';
import { CLASS } from './styles';

const RULES = `
:host([data-pb-panel='rest']) .${CLASS.bubble}[data-pb-open][data-mark-id] { display: block !important; }
.${CLASS.dot}[data-state='done'] { pointer-events: auto; cursor: pointer; }
`;

function addStyle(root: ShadowRoot): void {
  if (root.querySelector('style[data-pb-reopen-styles]')) return;
  root.append(
    root.ownerDocument
      .createRange()
      .createContextualFragment(`<style data-pb-reopen-styles>${RULES}</style>`),
  );
}

const wired = new WeakSet<TrackedMark>();

function wireDot(mark: TrackedMark): void {
  if (wired.has(mark)) return;
  wired.add(mark);
  mark.dot.element.addEventListener('click', () => {
    const bubble = mark.bubble.element;
    if (bubble.hasAttribute('data-pb-open')) bubble.removeAttribute('data-pb-open');
    else bubble.setAttribute('data-pb-open', '');
  });
}

// Escape in the box cancels it before the panel's capture listener closes an open panel.
// The listener goes with the box: a destroyed overlay, Dismiss or Clear sent removes it too.
function escapeFirst(doc: Document, textarea: HTMLTextAreaElement, cancel: () => void): () => void {
  const win = doc.defaultView;
  const gone = new MutationObserver(() => {
    if (!textarea.isConnected) stop();
  });
  const stop = (): void => {
    gone.disconnect();
    win?.removeEventListener('keydown', onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!textarea.isConnected) return stop();
    if (event.key !== 'Escape' || event.isComposing || !event.composedPath().includes(textarea))
      return;
    event.stopImmediatePropagation();
    cancel();
  };
  win?.addEventListener('keydown', onKey, true);
  gone.observe(textarea.getRootNode(), { childList: true, subtree: true });
  return stop;
}

/** Fixed bubble of a mark: Still wrong? opens the reopen box, which sends through the port. */
export function offerReopen(mark: TrackedMark, event: Status, reopen: ReopenPort): void {
  const id = mark.id;
  if (id === undefined) return;
  const element = mark.bubble.element;
  const doc = element.ownerDocument;
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) addStyle(root);
  wireDot(mark);
  const host = root instanceof ShadowRoot ? root.host : element;
  // A rebuilt bubble loses the add-ons' controls (Dismiss); a sync puts them back.
  const sync = (): boolean => host.dispatchEvent(new Event('passback:sync'));
  let stop = (): void => {};
  const offer = (): void => {
    appendStillWrong(doc, element, () => {
      const { textarea } = renderReopenBox(doc, element, { onSend: send, onCancel: () => back() });
      stop = escapeFirst(doc, textarea, () => back());
    });
  };
  const back = (): void => {
    stop();
    mark.bubble.showStatus(event);
    offer();
    sync();
  };
  const send = (comment: string): void => {
    stop();
    void reopen.send(id, comment).then((queued) => {
      if (queued) return;
      mark.bubble.showError('the dev server did not confirm it.', () => send(comment));
      sync();
    });
  };
  offer();
}
