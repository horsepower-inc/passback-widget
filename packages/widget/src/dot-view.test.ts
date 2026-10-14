// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createDot, createOutline, setCrosshair, type DotState } from './dot-view';
import { CLASS, styleSheet } from './styles';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.cursor = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

describe('createDot', () => {
  it('places the dot at the point', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 12, y: 34 });
    expect(dot.element.style.left).toBe('12px');
    expect(dot.element.style.top).toBe('34px');
  });

  it('starts the dot in the pinned state', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 0, y: 0 });
    expect(dot.element.getAttribute('data-state')).toBe('pinned');
    expect(dot.element.className).toBe(CLASS.dot);
  });

  it('writes the status onto the dot', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 0, y: 0 });
    dot.setState('running');
    expect(dot.element.getAttribute('data-state')).toBe('running');
    dot.setState('failed');
    expect(dot.element.getAttribute('data-state')).toBe('failed');
  });

  it('removes the dot', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 0, y: 0 });
    dot.remove();
    expect(root.contains(dot.element)).toBe(false);
  });
});

describe('createOutline', () => {
  it('sizes the outline to the element rect', () => {
    const root = shadowRoot();
    const target = document.createElement('div');
    document.body.appendChild(target);
    target.getBoundingClientRect = () => ({
      left: 5,
      top: 10,
      width: 100,
      height: 50,
      right: 105,
      bottom: 60,
      x: 5,
      y: 10,
      toJSON() {
        return this;
      },
    });

    const outline = createOutline(root);
    outline.show(target);

    const el = root.querySelector<HTMLElement>(`.${CLASS.outline}`)!;
    expect(el.style.left).toBe('5px');
    expect(el.style.top).toBe('10px');
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('50px');
    expect(el.hidden).toBe(false);
  });

  it('hides the outline for null', () => {
    const root = shadowRoot();
    const outline = createOutline(root);
    const el = root.querySelector<HTMLElement>(`.${CLASS.outline}`)!;
    expect(el.hidden).toBe(true);

    outline.show(document.body);
    expect(el.hidden).toBe(false);

    outline.show(null);
    expect(el.hidden).toBe(true);
  });

  it('removes the outline on destroy', () => {
    const root = shadowRoot();
    const outline = createOutline(root);
    const el = root.querySelector<HTMLElement>(`.${CLASS.outline}`)!;
    outline.destroy();
    expect(root.contains(el)).toBe(false);
  });
});

describe('setCrosshair', () => {
  it('sets and restores the document cursor', () => {
    document.documentElement.style.cursor = 'pointer';
    setCrosshair(document, true);
    expect(document.documentElement.style.cursor).toBe('crosshair');
    setCrosshair(document, false);
    expect(document.documentElement.style.cursor).toBe('pointer');
  });

  it('keeps the first remembered cursor when set twice', () => {
    document.documentElement.style.cursor = 'help';
    setCrosshair(document, true);
    document.documentElement.style.cursor = 'crosshair';
    setCrosshair(document, true);
    setCrosshair(document, false);
    expect(document.documentElement.style.cursor).toBe('help');
  });
});

describe('createDot moveTo and orphaned', () => {
  it('moveTo places the dot at the new point', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 1, y: 2 });
    dot.moveTo({ x: 56, y: 78 });
    expect(dot.element.style.left).toBe('56px');
    expect(dot.element.style.top).toBe('78px');
  });

  it('writes the orphaned state onto the dot', () => {
    const root = shadowRoot();
    const dot = createDot(root, { x: 0, y: 0 });
    dot.setState('orphaned');
    expect(dot.element.getAttribute('data-state')).toBe('orphaned');
  });
});

const FAILED_PATH = 'M6 2.5v4.5M6 9.3v.2';
const SYMBOLS: Readonly<Record<string, string>> = {
  sending: 'M6 1.5a4.5 4.5 0 1 1-4.5 4.5',
  queued: 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.5V6l1.8 1.2',
  running: 'M4.2 2.8l5 3.2-5 3.2z',
  done: 'M2.5 6.5l2.5 2.5 4.5-5.5',
  failed: FAILED_PATH,
  orphaned: FAILED_PATH,
};

function pinFor(state: DotState): HTMLElement {
  const dot = createDot(shadowRoot(), { x: 0, y: 0 });
  dot.setState(state);
  return dot.element;
}

function ruleBody(selector: string): string {
  const css = styleSheet().replace(/\s+/g, ' ');
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('pin symbols', () => {
  it('shows the number 1 on a pin that is not sent yet', () => {
    const el = createDot(shadowRoot(), { x: 0, y: 0 }).element;
    expect(el.textContent).toBe('1');
    expect(el.querySelector('svg')).toBeNull();
  });

  it('draws one svg with one path for every state after pinned', () => {
    for (const state of Object.keys(SYMBOLS) as DotState[]) {
      const el = pinFor(state);
      expect(el.children).toHaveLength(1);
      const svg = el.children[0]!;
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 12 12');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.children).toHaveLength(1);
      expect(svg.children[0]!.tagName.toLowerCase()).toBe('path');
    }
  });

  it('gives each state its own symbol and reuses the failed one for orphaned', () => {
    for (const [state, d] of Object.entries(SYMBOLS)) {
      expect(pinFor(state as DotState).querySelector('path')!.getAttribute('d')).toBe(d);
    }
    expect(pinFor('orphaned').querySelector('path')!.getAttribute('d')).toBe(
      pinFor('failed').querySelector('path')!.getAttribute('d'),
    );
  });

  it('fills the play mark and leaves the other symbols as strokes', () => {
    for (const state of Object.keys(SYMBOLS)) {
      const fill = pinFor(state as DotState).querySelector('path')!.getAttribute('fill');
      expect(fill).toBe(state === 'running' ? 'currentColor' : null);
    }
  });

  it('replaces the symbol when the state changes and goes back to the number', () => {
    const dot = createDot(shadowRoot(), { x: 0, y: 0 });
    dot.setState('done');
    dot.setState('failed');
    expect(dot.element.querySelectorAll('svg')).toHaveLength(1);
    expect(dot.element.querySelector('path')!.getAttribute('d')).toBe(FAILED_PATH);
    dot.setState('pinned');
    expect(dot.element.querySelector('svg')).toBeNull();
    expect(dot.element.textContent).toBe('1');
    expect(() => dot.setState('mystery' as DotState)).not.toThrow();
    expect(dot.element.children).toHaveLength(0);
  });

  it('names the state for a screen reader', () => {
    const labels: Record<DotState, string> = {
      pinned: 'Not sent yet',
      sending: 'Sending',
      queued: 'Waiting',
      running: 'Agent working',
      sent: 'Sent',
      done: 'Fixed',
      failed: 'Failed',
      orphaned: 'The marked element is gone',
    };
    for (const [state, label] of Object.entries(labels)) {
      const el = pinFor(state as DotState);
      expect(el.getAttribute('role')).toBe('img');
      expect(el.getAttribute('aria-label')).toBe(label);
    }
  });

});

describe('pin look', () => {
  it('gives the pin its round look with the ring and the halo', () => {
    const body = ruleBody(`.${CLASS.dot}`);
    expect(body).toContain('display: grid');
    expect(body).toContain('place-items: center');
    expect(body).toContain('border-radius: var(--pb-radius-pin)');
    expect(body).toContain('color: var(--pb-color-on-main)');
    expect(body).toContain(
      'box-shadow: 0 0 0 2px var(--pb-color-on-main), 0 0 0 3px var(--pb-color-halo), var(--pb-shadow-box)',
    );
    expect(ruleBody(`.${CLASS.dot} svg`)).toContain('stroke: currentColor');
  });

  it('colours the fixed and the failed pin and fades the orphaned one', () => {
    const done = ruleBody(`.${CLASS.dot}[data-state="done"]`);
    expect(done).toContain('background: var(--pb-color-ok)');
    expect(done).toContain('color: var(--pb-color-on-status)');
    const failed = ruleBody(`.${CLASS.dot}[data-state="failed"]`);
    expect(failed).toContain('background: var(--pb-color-bad)');
    expect(failed).toContain('color: var(--pb-color-on-status)');
    const orphaned = ruleBody(`.${CLASS.dot}[data-state="orphaned"]`);
    expect(orphaned).toBe(`.${CLASS.dot}[data-state="orphaned"] { opacity: var(--pb-opacity-idle); `);
  });

});

describe('choosing hint and border', () => {
  const hintOf = (root: ShadowRoot) => root.querySelector<HTMLElement>(`.${CLASS.hint}`);

  it('shows the hint while choosing and removes it on destroy', () => {
    const root = shadowRoot();
    const outline = createOutline(root);
    outline.show(document.body);
    expect(hintOf(root)!.hidden).toBe(false);
    outline.destroy();
    expect(hintOf(root)).toBeNull();
  });

  it('words the hint with the leave key and announces it as a status', () => {
    const root = shadowRoot();
    const hint = (createOutline(root), hintOf(root)!);
    expect(hint.textContent).toBe(`Click anything to comment ${String.fromCharCode(0xb7)} Esc to leave`);
    expect(hint.getAttribute('role')).toBe('status');
  });

  it('draws the choosing border 2px solid in the accent colour, 2px off the edge', () => {
    const body = ruleBody(`.${CLASS.outline}`);
    expect(body).toContain('outline: 2px solid var(--pb-color-accent);');
    expect(body).toContain('outline-offset: 2px;');
    expect(body).not.toMatch(/box-shadow|transition/);
  });

  it('puts the hint at the top centre and lets clicks through', () => {
    const body = ruleBody(`.${CLASS.hint}`);
    const wants = ['left: 50%', 'top: 10px', 'transform: translateX(-50%)', 'white-space: nowrap'];
    wants.forEach((d) => expect(body).toContain(d));
    expect(body).not.toContain('pointer-events');
  });
});
