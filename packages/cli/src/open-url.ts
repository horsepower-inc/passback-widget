import { win32 } from 'node:path';

/**
 * The command that opens an address in the default browser. On Windows `cmd /c start` would read
 * every `&` in an OAuth approval link as a command separator and open it without `state` or
 * `redirect_uri`, so the link goes to `rundll32 url.dll,FileProtocolHandler`, which takes it as one
 * argument without a shell. It is launched by its absolute System32 path, never by bare name,
 * because libuv searches the current folder first and would run a planted `rundll32.exe`.
 */
export function openerFor(
  platform: NodeJS.Platform,
  url: string,
  env: Record<string, string | undefined> = {},
): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') {
    const set = env.SystemRoot;
    // Only a drive path (`D:\Win`) or a UNC path is fully qualified; `Windows`, `\Windows` and
    // `D:Win` would resolve against the current folder or drive.
    const root = set && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(set) ? set : 'C:\\Windows';
    return [win32.join(root, 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url]];
  }
  return ['xdg-open', [url]];
}
