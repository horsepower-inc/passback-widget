import { describe, expect, it } from 'vitest';
import { parseConnect } from './args-connect';
import { usageMessage } from './usage-message';

const usage = { cmd: 'usage', error: 'connect' };
const app = { cmd: 'usage', error: 'trello-app' };

describe('parseConnect trello', () => {
  it('parses connect trello without a key or token', () => {
    expect(parseConnect(['trello', '--to', 'Web/Todo', '--site', 'shop', '--json'])).toEqual({
      cmd: 'connect',
      tracker: 'trello',
      to: 'Web/Todo',
      site: 'shop',
      json: true,
    });
    expect(parseConnect(['trello'])).toEqual({ cmd: 'connect', tracker: 'trello', json: false });
  });
  it('refuses --key and --token for Trello with the Passback app message', () => {
    expect(parseConnect(['trello', '--key', 'K'])).toEqual(app);
    expect(parseConnect(['trello', '--token', 'T'])).toEqual(app);
    expect(parseConnect(['trello', '--key', 'K', '--token', 'T'])).toEqual(app);
    expect(parseConnect(['trello', '--key'])).toEqual(app);
    expect(parseConnect(['trello', '--token'])).toEqual(app);
    expect(parseConnect(['trello', '--to', 'Web/Todo', '--key', '--json'])).toEqual(app);
    expect(usageMessage('trello-app')).toBe(
      'passback: Trello connects through the Passback app: run passback connect trello without --key and --token.',
    );
  });
  it('refuses --workspace for Trello and --token for another tracker', () => {
    expect(parseConnect(['trello', '--workspace', 'w'])).toEqual(usage);
    expect(parseConnect(['linear', '--key', 'K', '--token', 'T'])).toEqual(usage);
    expect(parseConnect(['jira', '--token', 'T'])).toEqual(usage);
  });
});
