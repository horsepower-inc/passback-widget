import { componentName, findFiber, MAX_CHAIN } from '@passback/collectors';

const SOURCE_RE = /^(.+):(\d+):\d+$/;

function components(el: Element): string[] {
  const names: string[] = [];
  let fiber = findFiber(el);
  let steps = 0;
  while (fiber && steps < MAX_CHAIN * 4 && names.length < 2) {
    const name = componentName(fiber);
    if (name !== undefined) {
      const { key } = fiber as { key?: string | null };
      names.push(key === undefined || key === null ? name : `${name}[key=${key}]`);
    }
    fiber = fiber.return ?? undefined;
    steps += 1;
  }
  return names.reverse();
}

function sourceOf(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const source = node.getAttribute('data-source');
    if (!source) continue;
    const match = SOURCE_RE.exec(source);
    return match ? `${match[1]!.split('/').pop()}:${match[2]}` : '';
  }
  return '';
}

function plain(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testid = el.getAttribute('data-testid');
  if (testid) return testid;
  if (el.id) return `${tag}#${el.id}`;
  const first = el.classList[0];
  return first ? `${tag}.${first}` : tag;
}

/** The nearest meaningful name of an element: its last two React components with keys and the source line, else a test id or tag. */
export function labelOf(el: Element): string {
  const names = components(el);
  if (names.length === 0) return plain(el);
  const source = sourceOf(el);
  return source ? `${names.join(' › ')} · ${source}` : names.join(' › ');
}
