export const PR_STORAGE_KEY = 'passback:pr';

const HASH_FORM = /^#pb-pr([1-9]\d{0,8})$/;
const NUMBER_FORM = /^[1-9]\d{0,8}$/;

type Win = Pick<Window, 'location' | 'sessionStorage'>;

/** What a link put in the address, kept for the tab: a valid value from the address, else the valid one kept before. */
export function keptFromAddress(
  win: Win,
  key: string,
  form: RegExp,
  address: () => string | null | undefined,
): string | undefined {
  let found: string | null | undefined;
  try {
    found = address();
  } catch {
    // an unreadable address is "not found"
  }
  try {
    if (found && form.test(found)) {
      try {
        win.sessionStorage.setItem(key, found);
      } catch {
        // storage blocked: the value is still returned, nothing is kept
      }
      return found;
    }
    const kept = win.sessionStorage.getItem(key);
    if (kept !== null && form.test(kept)) return kept;
  } catch {
    // storage blocked
  }
  return undefined;
}

export function pullRequestOf(win: Win): number | undefined {
  const found = keptFromAddress(
    win,
    PR_STORAGE_KEY,
    NUMBER_FORM,
    () =>
      HASH_FORM.exec(win.location.hash)?.[1] ??
      new URLSearchParams(win.location.search).get('pb-pr'),
  );
  return found === undefined ? undefined : Number(found);
}
