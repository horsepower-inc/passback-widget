export const PR_STORAGE_KEY = 'passback:pr';

const HASH_FORM = /^#pb-pr([1-9]\d{0,8})$/;
const NUMBER_FORM = /^[1-9]\d{0,8}$/;

type Win = Pick<Window, 'location' | 'sessionStorage'>;

function fromAddress(win: Win): number | undefined {
  try {
    const hashed = HASH_FORM.exec(win.location.hash)?.[1];
    if (hashed !== undefined) return Number(hashed);
    const value = new URLSearchParams(win.location.search).get('pb-pr');
    if (value !== null && NUMBER_FORM.test(value)) return Number(value);
  } catch {
    // an unreadable address is "not found"
  }
  return undefined;
}

function fromStorage(win: Win): number | undefined {
  try {
    const kept = win.sessionStorage.getItem(PR_STORAGE_KEY);
    if (kept !== null && NUMBER_FORM.test(kept)) return Number(kept);
  } catch {
    // storage blocked
  }
  return undefined;
}

function keep(win: Win, number: number): void {
  try {
    win.sessionStorage.setItem(PR_STORAGE_KEY, String(number));
  } catch {
    // storage blocked: the number is still returned, nothing is kept
  }
}

export function pullRequestOf(win: Win): number | undefined {
  const found = fromAddress(win);
  if (found === undefined) return fromStorage(win);
  keep(win, found);
  return found;
}
