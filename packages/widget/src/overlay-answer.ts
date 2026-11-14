import type { AnswerPort } from './answer';
import type { Status } from './bubble-view';
import type { TrackedMark } from './overlay-reattach';
import { prepareBubble } from './overlay-reopen';
import { renderAskBox } from './reply-box';

/** Bubble of a mark with a question: opens the answer card, which sends through the port. */
export function offerAnswer(mark: TrackedMark, event: Status, answer: AnswerPort): void {
  const id = mark.id;
  const question = event.message;
  if (id === undefined || !question) return;
  const element = mark.bubble.element;
  const doc = element.ownerDocument;
  prepareBubble(mark);
  element.setAttribute('data-pb-open', '');
  const root = element.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : element;
  const send = (text: string): void => {
    void answer.send(id, text).then((taken) => {
      if (taken) return;
      mark.bubble.showError('the dev server did not confirm it.', () => send(text));
      host.dispatchEvent(new Event('passback:sync'));
    });
  };
  renderAskBox(doc, element, { question, onSend: send });
}
