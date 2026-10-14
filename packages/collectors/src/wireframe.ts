import type { Rect } from '@passback/schema';

export const WIREFRAME_MARGIN = 16;
export const WIREFRAME_LABEL_MAX = 80;
export const WIREFRAME_MAX_BYTES = 20480;

export type WireframeRects = {
  self: Rect;
  parent: Rect;
  prev?: Rect;
  next?: Rect;
  positioned?: Rect;
};

type RenderWireframeInput = {
  rects: WireframeRects;
  selector?: string;
};

const RECT_ORDER = ['parent', 'positioned', 'prev', 'next', 'self'] as const;

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rectStyle(role: (typeof RECT_ORDER)[number]): string {
  switch (role) {
    case 'parent':
      return 'fill="none" stroke="#666" stroke-dasharray="4 2"';
    case 'positioned':
      return 'fill="none" stroke="#999" stroke-dasharray="1 2"';
    case 'prev':
    case 'next':
      return 'fill="#ddd" stroke="none"';
    case 'self':
      return 'fill="rgba(255,0,0,0.2)" stroke="red"';
  }
}

function boundingBox(rects: Rect[]): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return {
    minX: minX - WIREFRAME_MARGIN,
    minY: minY - WIREFRAME_MARGIN,
    width: maxX - minX + WIREFRAME_MARGIN * 2,
    height: maxY - minY + WIREFRAME_MARGIN * 2,
  };
}

export function renderWireframe(input: RenderWireframeInput): string {
  const { rects, selector } = input;

  const present = RECT_ORDER.filter((role) => rects[role] !== undefined).map((role) => ({
    role,
    rect: rects[role] as Rect,
  }));

  const box = boundingBox(present.map(({ rect }) => rect));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(box.minX)} ${num(box.minY)} ${num(box.width)} ${num(box.height)}" width="${num(box.width)}" height="${num(box.height)}">`,
  );

  for (const { role, rect } of present) {
    parts.push(
      `<rect data-role="${role}" x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" ${rectStyle(role)}/>`,
    );
  }

  if (selector !== undefined) {
    const truncated = selector.slice(0, WIREFRAME_LABEL_MAX);
    const selfRect = rects.self;
    parts.push(
      `<text data-role="selector" x="${num(selfRect.x)}" y="${num(selfRect.y - 4)}">${escapeXml(truncated)}</text>`,
    );
  }

  const selfRect = rects.self;
  parts.push(
    `<text data-role="dimensions" x="${num(selfRect.x)}" y="${num(selfRect.y + selfRect.height + 14)}">${num(selfRect.width)}x${num(selfRect.height)}</text>`,
  );

  parts.push('</svg>');

  return parts.join('');
}
