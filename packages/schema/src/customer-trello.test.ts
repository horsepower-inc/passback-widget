import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, SaveIntegration, VerifyRequest } from './customer';

const credential = 'aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb';
const boardId = '5f1e2d3c4b5a69788796a5b4';
const listId = '0123456789abcdef01234567';

describe('trello connect request', () => {
  it('accepts a Trello verify request with only a credential', () => {
    expect(VerifyRequest.safeParse({ tracker: 'trello', credential }).success).toBe(true);
    expect(VerifyRequest.safeParse({ tracker: 'trello', credential, boardId }).success).toBe(false);
  });

  it('accepts a Trello save with a board id and a list id', () => {
    const parsed = SaveIntegration.safeParse({
      tracker: 'trello',
      credential,
      boardId,
      project: listId,
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a Trello save without a board id, with a short or upper-case id or with an unknown field', () => {
    const base = { tracker: 'trello', credential, boardId, project: listId };
    expect(SaveIntegration.safeParse(base).success).toBe(true);
    const withoutBoard = { tracker: 'trello', credential, project: listId };
    expect(SaveIntegration.safeParse(withoutBoard).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, boardId: boardId.slice(1) }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, project: listId.slice(1) }).success).toBe(false);
    expect(SaveIntegration.safeParse({ ...base, boardId: boardId.toUpperCase() }).success).toBe(
      false,
    );
    expect(SaveIntegration.safeParse({ ...base, project: listId.toUpperCase() }).success).toBe(
      false,
    );
    expect(SaveIntegration.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('names trello in the tracker list and keeps the others', () => {
    expect([...CUSTOMER_TRACKERS]).toEqual(
      expect.arrayContaining([
        'linear',
        'plane',
        'github',
        'jira',
        'azure-devops',
        'gitlab',
        'trello',
      ]),
    );
  });
});
