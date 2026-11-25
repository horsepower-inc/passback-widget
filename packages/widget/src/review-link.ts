import { keptFromAddress } from './pr-link';

export const REVIEW_STORAGE_KEY = 'passback:review';

const HASH_FORM = /^#pb-review(.*)$/;
const ID_FORM = /^[a-z2-7]{26}$/;

// The id is a secret: only the hash is read, never the query string, which reaches servers and Referer headers.
export function reviewOf(win: Pick<Window, 'location' | 'sessionStorage'>): string | undefined {
  return keptFromAddress(
    win,
    REVIEW_STORAGE_KEY,
    ID_FORM,
    () => HASH_FORM.exec(win.location.hash)?.[1],
  );
}
