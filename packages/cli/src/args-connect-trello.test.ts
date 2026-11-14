import { describe, expect, it } from 'vitest';
import { parseConnect } from './args-connect';

const usage = { cmd: 'usage', error: 'connect' };

describe('parseConnect trello', () => {
  it('parses connect trello with --key and --token into one joined key', () => {
    expect(
      parseConnect(['trello', '--key', ' K ', '--token', 'T', '--to', 'Web/Todo', '--json']),
    ).toEqual({ cmd: 'connect', tracker: 'trello', key: 'K:T', to: 'Web/Todo', json: true });
  });
  it('refuses connect trello without a token or with --workspace, and --token for another tracker', () => {
    expect(parseConnect(['trello', '--key', 'K'])).toEqual(usage);
    expect(parseConnect(['trello', '--token', 'T'])).toEqual(usage);
    expect(parseConnect(['trello'])).toEqual(usage);
    expect(parseConnect(['trello', '--key', 'K', '--token', 'T', '--workspace', 'w'])).toEqual(
      usage,
    );
    expect(parseConnect(['linear', '--key', 'K', '--token', 'T'])).toEqual(usage);
    expect(parseConnect(['jira', '--token', 'T'])).toEqual(usage);
  });
});
