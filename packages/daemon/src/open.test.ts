import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_URL,
  openCommand,
  openInBrowser,
  resolveOpenUrl,
  spawnDetached,
  type Spawn,
} from './open';

describe('resolveOpenUrl', () => {
  it('uses the url it is given', () => {
    expect(resolveOpenUrl('http://example.com', { PASSBACK_URL: 'http://env.example' })).toBe(
      'http://example.com',
    );
  });

  it('falls back to PASSBACK_URL, then to the Vite default', () => {
    expect(resolveOpenUrl(undefined, { PASSBACK_URL: 'http://env.example' })).toBe(
      'http://env.example',
    );
    expect(resolveOpenUrl(undefined, {})).toBe(DEFAULT_URL);
    expect(resolveOpenUrl('', { PASSBACK_URL: '' })).toBe(DEFAULT_URL);
  });
});

describe('openInBrowser', () => {
  it('opens with open on macOS', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    await openInBrowser('http://localhost:5173', { platform: 'darwin', spawn });
    expect(spawn).toHaveBeenCalledWith('open', ['http://localhost:5173/']);
  });

  it('opens with explorer.exe on Windows', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    await openInBrowser('http://localhost:5173', { platform: 'win32', spawn });
    expect(spawn).toHaveBeenCalledWith('explorer.exe', ['http://localhost:5173/']);
  });

  it('opens with xdg-open elsewhere', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    await openInBrowser('http://localhost:5173', { platform: 'linux', spawn });
    expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://localhost:5173/']);
  });

  it('passes the url as a single argument', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    const url = 'http://localhost:5173/?q=a%20b&x=1';
    await openInBrowser(url, { platform: 'linux', spawn });
    expect(spawn).toHaveBeenCalledWith('xdg-open', [new URL(url).href]);
    expect(spawn.mock.calls[0]?.[1]).toEqual([new URL(url).href]);
  });

  it('opens the normalized href, not the raw string', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    const raw = '  http://localhost:5173/?q="a"\n';
    await openInBrowser(raw, { platform: 'win32', spawn });
    expect(spawn).toHaveBeenCalledWith('explorer.exe', [new URL(raw).href]);
    expect(spawn.mock.calls[0]?.[1]).not.toEqual([raw]);
  });

  it('rejects a non-http url and spawns nothing', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    await expect(openInBrowser('file:///etc/passwd', { spawn })).rejects.toThrow(
      'passback_open needs an http(s) URL: file:///etc/passwd',
    );
    await expect(openInBrowser('javascript:alert(1)', { spawn })).rejects.toThrow(
      'passback_open needs an http(s) URL: javascript:alert(1)',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a string that is not a url and spawns nothing', async () => {
    const spawn = vi.fn<Spawn>().mockResolvedValue(undefined);
    await expect(openInBrowser('not a url', { spawn })).rejects.toThrow(
      'passback_open needs an http(s) URL: not a url',
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('spawnDetached', () => {
  it('spawnDetached resolves once the process has started', async () => {
    await expect(spawnDetached(process.execPath, ['-e', ''])).resolves.toBeUndefined();
  });

  it('spawnDetached rejects when the command does not exist', async () => {
    await expect(spawnDetached('passback-no-such-opener', [])).rejects.toThrow();
  });
});

describe('openCommand', () => {
  it('builds the right command per platform', () => {
    expect(openCommand('darwin', 'http://x')).toEqual({ cmd: 'open', args: ['http://x'] });
    expect(openCommand('win32', 'http://x')).toEqual({ cmd: 'explorer.exe', args: ['http://x'] });
    expect(openCommand('linux', 'http://x')).toEqual({ cmd: 'xdg-open', args: ['http://x'] });
  });
});
