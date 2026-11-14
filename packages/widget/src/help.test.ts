// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountHelp } from './help';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function setup(pictures = false) {
  if (pictures) {
    const script = document.head.appendChild(document.createElement('script'));
    script.setAttribute('data-passback-screenshots', 'true');
    script.setAttribute('data-passback-shot', '/shot.js');
    script.setAttribute('data-passback-endpoint', '/e');
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const bar = root.appendChild(document.createElement('div'));
  bar.className = 'pb-palette';
  bar.setAttribute('data-open', '');
  stop = mountHelp(bar);
  const button = bar.querySelector<HTMLButtonElement>('button[data-act="help"]')!;
  const pop = () => bar.querySelector<HTMLElement>('[role="dialog"]')!;
  return { host, root, bar, button, pop };
}

const escape = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

describe('help', () => {
  it('adds a ? button at the end of the palette that opens one popover', () => {
    const { bar, button, pop } = setup();
    expect(button.textContent).toBe('?');
    expect(button.getAttribute('aria-label')).toBe('Help');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(bar.querySelector('style[data-pb-help-styles]')?.textContent).toContain('order: 99');
    expect(pop().getAttribute('aria-label')).toBe('About Passback');
    expect(pop().hasAttribute('data-open')).toBe(false);
    button.click();
    expect(pop().hasAttribute('data-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(bar.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    button.click();
    expect(pop().hasAttribute('data-open')).toBe(false);
  });

  it('the popover holds the line, the keys and a Powered by passback.dev link to https://passback.dev/?ref=widget with rel noopener', () => {
    const { button, pop } = setup();
    button.click();
    expect(pop().textContent).toContain('Mark anything on this page; your team gets it as a task.');
    expect(pop().textContent).toContain('Click to mark. Esc to leave. Enter sends.');
    const link = pop().querySelector('a')!;
    expect(link.textContent).toBe('Powered by passback.dev');
    expect(link.getAttribute('href')).toBe('https://passback.dev/?ref=widget');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('shows the screenshot line only when pictures are on and data-pb-pictures is not off', () => {
    const line = 'A screenshot of this tab is attached.';
    const off = setup();
    off.button.click();
    expect(off.pop().textContent).not.toContain(line);
    stop?.();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const on = setup(true);
    on.button.click();
    expect(on.pop().textContent).toContain(line);
    on.button.click();
    on.host.setAttribute('data-pb-pictures', 'off');
    on.button.click();
    expect(on.pop().textContent).not.toContain(line);
  });

  it('Escape closes the popover and a click outside closes it', () => {
    const { bar, button, pop } = setup();
    button.click();
    const seen: string[] = [];
    document.addEventListener('keydown', (event) => seen.push(event.key));
    escape();
    expect(pop().hasAttribute('data-open')).toBe(false);
    expect(seen).toEqual([]);
    escape();
    button.click();
    pop().click();
    expect(pop().hasAttribute('data-open')).toBe(true);
    document.body.click();
    expect(pop().hasAttribute('data-open')).toBe(false);
    button.click();
    bar.removeAttribute('data-open');
    return Promise.resolve().then(() => {
      expect(pop().hasAttribute('data-open')).toBe(false);
    });
  });

  it('keeps the button and the popover inside the shadow root the capture hides', () => {
    const { root, button, pop } = setup();
    button.click();
    expect(button.getRootNode()).toBe(root);
    expect(pop().getRootNode()).toBe(root);
    expect(document.querySelector('[data-act="help"], [role="dialog"], .pb-help')).toBeNull();
    stop?.();
    stop = undefined;
    expect(root.querySelector('style[data-pb-help-styles]')).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});
