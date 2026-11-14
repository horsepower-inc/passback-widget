export const STYLE_SHORTLIST = [
  'display',
  'position',
  'overflow-x',
  'overflow-y',
  'z-index',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
] as const;

export function collectStyles(el: Element): Record<string, string> {
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const key of STYLE_SHORTLIST) {
    const value = computed.getPropertyValue(key);
    if (value !== '') styles[key] = value;
  }
  return styles;
}
