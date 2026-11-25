import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

const usage = { cmd: 'usage', error: 'connect' };
const trelloApp = { cmd: 'usage', error: 'trello-app' };
const TRACKERS = [
  'linear',
  'plane',
  'github',
  'jira',
  'azure-devops',
  'gitlab',
  'trello',
  'notion',
  'asana',
  'clickup',
] as const;

describe('parseArgs connect --keep-key', () => {
  it('parseConnect accepts --keep-key without a key and refuses it with a key', () => {
    for (const tracker of TRACKERS) {
      expect(parseArgs(['connect', tracker, '--keep-key'])).toEqual({
        cmd: 'connect',
        tracker,
        keepKey: true,
        json: false,
      });
      expect(
        parseArgs(['connect', tracker, '--site', 'shop', '--keep-key', '--to', 'Web', '--json']),
      ).toEqual({ cmd: 'connect', tracker, keepKey: true, site: 'shop', to: 'Web', json: true });
      for (const [flag, value] of [
        ['--key', 'k'],
        ['--key', ''],
        ['--token', 't'],
        ['--token', ''],
        ['--workspace', 'acme'],
        ['--workspace', ''],
        ['--url', 'https://gitlab.example.test'],
        ['--url', ''],
      ] as const) {
        const trelloCredential = tracker === 'trello' && (flag === '--key' || flag === '--token');
        expect(parseArgs(['connect', tracker, '--keep-key', flag, value])).toEqual(
          trelloCredential ? trelloApp : usage,
        );
      }
      expect(parseArgs(['connect', tracker, '--keep-key', 'yes'])).toEqual(usage);
      expect(parseArgs(['connect', tracker, '--keep-key', '--to'])).toEqual(usage);
    }
    expect(parseArgs(['connect', '--keep-key'])).toEqual(usage);
    expect(parseArgs(['connect', 'webhook', '--keep-key'])).toEqual(usage);
    expect(
      parseArgs(['connect', 'webhook', '--url', 'https://hooks.example.test', '--keep-key']),
    ).toEqual(usage);
    expect(parseArgs(['connect', 'linear'])).not.toHaveProperty('keepKey');
    expect(parseArgs(['connect', 'trello'])).toEqual({
      cmd: 'connect',
      tracker: 'trello',
      json: false,
    });
    expect(parseArgs(['connect', 'trello', '--key', 'k', '--token', 't'])).toHaveProperty(
      'cmd',
      'usage',
    );
    expect(parseArgs(['connect', 'trello', '--keep-key', '--key', 'k'])).toEqual(trelloApp);
  });

  it('parseConnect keeps Azure DevOps type validation with --keep-key', () => {
    const base = ['connect', 'azure-devops', '--keep-key'];
    for (const [type, workItemType] of [
      ['bug', 'Bug'],
      ['BUG', 'Bug'],
      ['Task', 'Task'],
      ['tASK', 'Task'],
    ] as const) {
      expect(parseArgs([...base, '--type', type])).toEqual({
        cmd: 'connect',
        tracker: 'azure-devops',
        keepKey: true,
        workItemType,
        json: false,
      });
    }
    expect(parseArgs(base)).not.toHaveProperty('workItemType');
    expect(parseArgs([...base, '--type', 'epic'])).toEqual(usage);
    expect(parseArgs([...base, '--type', ''])).toEqual(usage);
    for (const tracker of TRACKERS.filter((name) => name !== 'azure-devops')) {
      expect(parseArgs(['connect', tracker, '--keep-key', '--type', 'bug'])).toEqual(usage);
    }
  });
});
