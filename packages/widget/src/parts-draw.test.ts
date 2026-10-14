// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { mountTools } from './shot-tools';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

function pencilOf() {
  const bubble = createBubble(shadowRoot(), {
    anchor: { x: 12, y: 34 },
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onDraw: vi.fn(),
  });
  const pencil = bubble.element.querySelector<HTMLButtonElement>('[data-role="draw"]')!;
  return { bubble, pencil };
}

function toolsOf() {
  const onTool = vi.fn();
  const tools = mountTools(shadowRoot(), {
    side: 'right',
    tool: 'arrow',
    onTool,
    onUndo: vi.fn(),
    onClear: vi.fn(),
  });
  const parts = () =>
    [...tools.element.querySelectorAll('button')].map((button) => button.getAttribute('part'));
  return { tools, parts };
}

describe('drawing parts', () => {
  it('names the pencil part pencil and adds pencil-on while it is pressed', () => {
    const { pencil } = pencilOf();
    expect(pencil.getAttribute('part')).toBe('pencil');
    pencil.click();
    expect(pencil.getAttribute('aria-pressed')).toBe('true');
    expect(pencil.getAttribute('part')).toBe('pencil pencil-on');
    pencil.click();
    expect(pencil.getAttribute('part')).toBe('pencil');
  });

  it('keeps the pencil part in step when setDrawing changes it', () => {
    const { bubble, pencil } = pencilOf();
    bubble.setDrawing(true);
    expect(pencil.getAttribute('part')).toBe('pencil pencil-on');
    bubble.setDrawing(false);
    expect(pencil.getAttribute('part')).toBe('pencil');
  });

  it('names each tool button part tool and its own name', () => {
    const { parts } = toolsOf();
    expect(parts().map((part) => part?.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'tool tool-arrow',
      'tool tool-line',
      'tool tool-box',
      'tool tool-undo',
      'tool tool-clear',
    ]);
  });

  it('adds tool-on to the pressed tool only and moves it on a click', () => {
    const { tools, parts } = toolsOf();
    expect(parts()).toEqual([
      'tool tool-arrow tool-on',
      'tool tool-line',
      'tool tool-box',
      'tool tool-undo',
      'tool tool-clear',
    ]);
    tools.element.querySelector<HTMLButtonElement>('[data-tool="box"]')!.click();
    expect(parts()).toEqual([
      'tool tool-arrow',
      'tool tool-line',
      'tool tool-box tool-on',
      'tool tool-undo',
      'tool tool-clear',
    ]);
  });
});
