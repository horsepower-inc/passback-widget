import { describe, expect, it } from 'vitest';
import { openerFor } from './open-url';

const APPROVAL =
  'https://gitlab.example.test/oauth/authorize?client_id=c1&redirect_uri=https%3A%2F%2Fapi.example.test%2Fcb&response_type=code&state=s1&code_challenge=x';

describe('openerFor', () => {
  it('on Windows the opener receives the full sign-in address with every query parameter', () => {
    const [command, args] = openerFor('win32', APPROVAL, {});
    expect(command).not.toBe('cmd');
    expect(args).toEqual(['url.dll,FileProtocolHandler', APPROVAL]);
  });

  it('macOS and Linux open the address exactly as before', () => {
    expect(openerFor('darwin', APPROVAL, {})).toEqual(['open', [APPROVAL]]);
    expect(openerFor('linux', APPROVAL, {})).toEqual(['xdg-open', [APPROVAL]]);
  });

  it('on Windows the opener is launched by its absolute System32 path, never by bare name', () => {
    expect(openerFor('win32', APPROVAL, { SystemRoot: 'D:\\Win' })[0]).toBe(
      'D:\\Win\\System32\\rundll32.exe',
    );
    expect(openerFor('win32', APPROVAL, {})[0]).toBe('C:\\Windows\\System32\\rundll32.exe');
  });

  it('ignores a SystemRoot that is not fully qualified and uses the fallback directory', () => {
    for (const SystemRoot of ['Windows', '\\Windows', 'D:Win', '.\\Windows']) {
      expect(openerFor('win32', APPROVAL, { SystemRoot })[0]).toBe(
        'C:\\Windows\\System32\\rundll32.exe',
      );
    }
  });
});
