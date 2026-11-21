import { describe, expect, it } from 'vitest';
import { chooseTarget, type Target } from './connect';
import { jiraBody, jiraChoices } from './connect-jira';

const targets: Target[] = [
  {
    id: 'cloud-1',
    label: 'Acme',
    children: [
      { id: 'ENG', label: 'ENG · Engineering' },
      { id: 'OPS', label: 'OPS · Operations' },
    ],
  },
  { id: 'cloud-2', label: 'Beta', children: [{ id: 'WEB', label: 'WEB · Website' }] },
];

describe('Jira choices', () => {
  it('lists each project of each Jira site as a choice named site / KEY · name', () => {
    expect(jiraChoices(targets)).toEqual([
      { project: 'cloud-1', projectId: 'ENG', where: 'Acme / ENG · Engineering' },
      { project: 'cloud-1', projectId: 'OPS', where: 'Acme / OPS · Operations' },
      { project: 'cloud-2', projectId: 'WEB', where: 'Beta / WEB · Website' },
    ]);
  });

  it('matches --to by key, by site and key, or by the full name', () => {
    const expected = { project: 'cloud-1', projectId: 'OPS', where: 'Acme / OPS · Operations' };
    expect(chooseTarget('jira', targets, 'ops')).toEqual(expected);
    expect(chooseTarget('jira', targets, 'acme/ops')).toEqual(expected);
    expect(chooseTarget('jira', targets, 'Acme / OPS · Operations')).toEqual(expected);
    expect(chooseTarget('jira', targets, 'nope')).toMatchObject({ error: 'no_match' });
    expect(chooseTarget('jira', targets, undefined)).toMatchObject({ error: 'pick_target' });
    expect(chooseTarget('jira', [targets[1]!], undefined)).toEqual({
      project: 'cloud-2',
      projectId: 'WEB',
      where: 'Beta / WEB · Website',
    });
  });

  it('builds the Jira save body with the cloud id and the key', () => {
    expect(jiraBody('pbc_x', { project: 'cloud-1', projectId: 'ENG', where: 'w' })).toEqual({
      tracker: 'jira',
      credential: 'pbc_x',
      cloudId: 'cloud-1',
      project: 'ENG',
    });
  });
});
