// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CLASS, styleSheet } from './styles';
import { TOKENS } from './tokens';

const css = styleSheet().replace(/\s+/g, ' ');
const selector = `.${CLASS.dot}[data-state="sending"]::after, .${CLASS.dot}[data-state="running"]::after`;

function ringBody(): string {
  const parts = css.split(selector);
  expect(parts).toHaveLength(2);
  return parts[1]!.slice(0, parts[1]!.indexOf('}'));
}

describe('the ring around the pin', () => {
  it('turns a ring in the accent colour around the pin while sending and while the agent is working', () => {
    const body = ringBody();
    for (const decl of [
      'content: ""',
      'position: absolute',
      'inset: -8px',
      'border-radius: 50%',
      'border: 2.5px solid transparent',
      'border-top-color: var(--pb-color-accent)',
      'border-right-color: var(--pb-color-accent)',
    ]) {
      expect(body).toContain(decl);
    }
  });

  it('makes one turn in the spin time of the style kit', () => {
    expect(ringBody()).toContain('animation: pb-spin var(--pb-motion-spin) linear infinite');
    expect(TOKENS['--pb-motion-spin']).toBe('0.8s');
    expect(css).toContain('@keyframes pb-spin { to { transform: rotate(360deg); } }');
  });

  it('keeps the arc of the sending pin still and has no pulse left', () => {
    expect(css).not.toContain('pb-pulse');
    expect(css).not.toContain('[data-state="sending"] svg');
    expect(css).not.toContain('0.9s');
    expect(css).not.toContain('inset: -5px');
  });

  it('stops the ring under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const at = reduced.indexOf(`.${CLASS.dot}[data-state]::after`);
    expect(at).toBeGreaterThan(-1);
    expect(reduced.slice(at)).toContain('animation: none');
  });
});
