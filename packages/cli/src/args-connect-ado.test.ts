import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

const usage = { cmd: 'usage', error: 'connect' };

describe('parseArgs connect azure-devops', () => {
  it('accepts azure-devops with a key and an organization', () => {
    expect(
      parseArgs(['connect', 'azure-devops', '--workspace', 'acme', '--key', 'tok', '--to', 'Shop']),
    ).toEqual({
      cmd: 'connect',
      tracker: 'azure-devops',
      key: 'tok',
      workspace: 'acme',
      to: 'Shop',
      json: false,
    });
  });

  it('refuses azure-devops without a key or without an organization', () => {
    expect(parseArgs(['connect', 'azure-devops', '--workspace', 'acme'])).toEqual(usage);
    expect(parseArgs(['connect', 'azure-devops', '--key', 'tok'])).toEqual(usage);
    expect(parseArgs(['connect', 'azure-devops'])).toEqual(usage);
  });

  it('reads --type bug and --type task in any case and refuses another value', () => {
    const base = ['connect', 'azure-devops', '--workspace', 'acme', '--key', 'tok'];
    expect(parseArgs([...base, '--type', 'bug'])).toMatchObject({ workItemType: 'Bug' });
    expect(parseArgs([...base, '--type', 'TASK'])).toMatchObject({ workItemType: 'Task' });
    expect(parseArgs([...base, '--type', 'Bug'])).toMatchObject({ workItemType: 'Bug' });
    expect(parseArgs([...base, '--type', 'epic'])).toEqual(usage);
  });

  it('refuses --type for another tracker', () => {
    expect(parseArgs(['connect', 'linear', '--type', 'bug'])).toEqual(usage);
    expect(
      parseArgs(['connect', 'plane', '--key', 'k', '--workspace', 'w', '--type', 'task']),
    ).toEqual(usage);
  });
});
