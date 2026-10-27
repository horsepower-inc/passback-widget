import { describe, expect, it } from 'vitest';
import { choices, chooseTarget } from './connect';
import { trelloBody } from './connect-trello';

const targets = [
  {
    id: 'b1',
    label: 'Web',
    children: [
      { id: 'l1', label: 'Todo' },
      { id: 'l2', label: 'Done' },
    ],
  },
  { id: 'b2', label: 'Ops', children: [{ id: 'l3', label: 'Todo' }] },
];

describe('connect trello choices', () => {
  it('lists each list of each board as a choice named board / list', () => {
    expect(choices('trello', targets)).toEqual([
      { project: 'b1', projectId: 'l1', where: 'Web / Todo' },
      { project: 'b1', projectId: 'l2', where: 'Web / Done' },
      { project: 'b2', projectId: 'l3', where: 'Ops / Todo' },
    ]);
  });
  it('matches --to by the full name or by board and list, case-insensitively', () => {
    const expected = { project: 'b2', projectId: 'l3', where: 'Ops / Todo' };
    expect(chooseTarget('trello', targets, ' ops / todo ')).toEqual(expected);
    expect(chooseTarget('trello', targets, 'OPS/Todo')).toEqual(expected);
    expect(chooseTarget('trello', targets, 'Nowhere/Todo')).toHaveProperty('error', 'no_match');
  });
  it('builds the Trello save body with the board id and the list id', () => {
    expect(trelloBody('K:T', { project: 'b1', projectId: 'l2', where: 'Web / Done' })).toEqual({
      tracker: 'trello',
      credential: 'K:T',
      boardId: 'b1',
      project: 'l2',
    });
  });
});
