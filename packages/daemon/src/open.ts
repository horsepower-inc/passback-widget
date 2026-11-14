import { spawn } from 'node:child_process';

export const DEFAULT_URL = 'http://localhost:5173';

export type Spawn = (cmd: string, args: string[]) => Promise<void>;

export function resolveOpenUrl(
  url: string | undefined,
  env: Record<string, string | undefined>,
): string {
  if (url) return url;
  if (env.PASSBACK_URL) return env.PASSBACK_URL;
  return DEFAULT_URL;
}

export function openCommand(platform: string, url: string): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

export const spawnDetached: Spawn = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });

export async function openInBrowser(
  url: string,
  opts: { platform?: string; spawn?: Spawn } = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`passback_open needs an http(s) URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`passback_open needs an http(s) URL: ${url}`);
  }
  const spawnFn = opts.spawn ?? spawnDetached;
  const { cmd, args } = openCommand(opts.platform ?? process.platform, parsed.href);
  await spawnFn(cmd, args);
}
