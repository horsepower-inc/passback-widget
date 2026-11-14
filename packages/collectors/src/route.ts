import { SECRET_KEY } from './serialize';

const REDACTED = '[redacted]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;
const NEXT_OPTIONAL_CATCH_ALL = /\[\[\.\.\.([^\]]+)\]\]/g;
const NEXT_CATCH_ALL = /\[\.\.\.([^\]]+)\]/g;
const NEXT_DYNAMIC = /\[([^\]]+)\]/g;

type NextWindow = Window & { __NEXT_DATA__?: { page?: unknown } };

function fromNextPage(page: string): string {
  return page
    .replace(NEXT_OPTIONAL_CATCH_ALL, ':$1*')
    .replace(NEXT_CATCH_ALL, ':$1*')
    .replace(NEXT_DYNAMIC, ':$1');
}

function fromPathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (DIGITS.test(segment) || UUID.test(segment) ? ':id' : segment))
    .join('/');
}

export function routePattern(win: Window): string {
  const page = (win as NextWindow).__NEXT_DATA__?.page;
  if (typeof page === 'string' && page.startsWith('/')) return fromNextPage(page);
  return fromPathname(win.location.pathname);
}

function maskQuery(query: string): { text: string; hit: boolean } {
  const masked = new URLSearchParams();
  let hit = false;
  for (const [key, value] of new URLSearchParams(query)) {
    const secret = SECRET_KEY.test(key);
    hit = hit || secret;
    masked.append(key, secret ? REDACTED : value);
  }
  return { text: masked.toString(), hit };
}

export function safeUrl(win: Window): string {
  const url = new URL(win.location.href);
  url.hash = '';
  url.search = maskQuery(url.search).text;
  return url.toString();
}

export function safeHref(value: string): string {
  try {
    const noHash = value.split('#')[0] ?? '';
    const at = noHash.indexOf('?');
    if (at < 0) return noHash;
    const { text, hit } = maskQuery(noHash.slice(at + 1));
    return hit ? `${noHash.slice(0, at)}?${text}` : noHash;
  } catch {
    return value;
  }
}
