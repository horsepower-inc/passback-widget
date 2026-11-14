import type { Environment } from '@passback/schema';

interface NavigatorConnection {
  connection?: { effectiveType?: unknown };
}

function colorSchemeAndMotion(win: Window): {
  colorScheme: 'light' | 'dark';
  reducedMotion: boolean;
} {
  if (typeof win.matchMedia !== 'function') {
    return { colorScheme: 'light', reducedMotion: false };
  }
  const colorScheme = win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { colorScheme, reducedMotion };
}

function connection(win: Window): string | undefined {
  const effectiveType = (win.navigator as NavigatorConnection).connection?.effectiveType;
  return typeof effectiveType === 'string' ? effectiveType : undefined;
}

export function collectEnvironment(win: Window): Environment {
  const { colorScheme, reducedMotion } = colorSchemeAndMotion(win);
  const effectiveType = connection(win);

  return {
    ua: win.navigator.userAgent,
    viewport: [win.innerWidth, win.innerHeight],
    dpr: win.devicePixelRatio || 1,
    locale: win.navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorScheme,
    reducedMotion,
    ...(effectiveType === undefined ? {} : { connection: effectiveType }),
  };
}
