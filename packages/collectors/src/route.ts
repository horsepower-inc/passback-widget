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

export function safeUrl(win: Window): string {
  const url = new URL(win.location.href);
  url.hash = '';
  const masked = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    masked.append(key, SECRET_KEY.test(key) ? REDACTED : value);
  }
  url.search = masked.toString();
  return url.toString();
}
