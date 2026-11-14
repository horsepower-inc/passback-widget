export const TEXT_MATCH_MAX = 200;

const PLAIN_TAG_NAME = /^[a-z][a-z0-9-]*$/i;

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MATCH_MAX);
}

export function findByTagAndText(
  root: Document | Element,
  tag: string,
  text: string,
): Element | null {
  if (!PLAIN_TAG_NAME.test(tag)) {
    return null;
  }

  const normalizedTarget = normalizeText(text);
  if (normalizedTarget === '') {
    return null;
  }

  const candidates = Array.from(root.querySelectorAll(tag)).filter(
    (el) => normalizeText(el.textContent ?? '') === normalizedTarget,
  );

  return candidates.length === 1 ? (candidates[0] as Element) : null;
}
