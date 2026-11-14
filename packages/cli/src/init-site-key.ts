// `init --site <key>`: the key is public, so writing it into the plugin options needs no login.

import { apiBase } from './account';
import type { SiteOptions } from './site-options';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function keyedSite(
  key: string,
  env: { PASSBACK_API_URL?: string },
  io: { out: (line: string) => void; err: (line: string) => void },
): SiteOptions | undefined {
  if (!KEY_PATTERN.test(key)) {
    io.err('passback: the site key may hold only letters, digits, underscore and dash.');
    return undefined;
  }
  const endpoint = apiBase(undefined, env);
  io.out(`Using site key ${key} with endpoint ${endpoint} (no login needed).`);
  return { siteKey: key, endpoint };
}
