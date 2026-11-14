// Trello destinations: a board and a list. The credential is `<API key>:<token>`.

import type { Choice, Target } from './connect-types';

export function trelloKey(key: string, token: string): string {
  return `${key.trim()}:${token.trim()}`;
}

export function trelloChoices(targets: Target[]): Choice[] {
  return targets.flatMap((board) =>
    (board.children ?? []).map((list) => ({
      project: board.id,
      projectId: list.id,
      where: `${board.label} / ${list.label}`,
    })),
  );
}

/** A list name is not unique, so only the board and list together name a choice. */
export function trelloAliases(choice: Choice, targets: Target[]): string[] {
  const board = targets.find((target) => target.id === choice.project);
  const list = board?.children?.find((child) => child.id === choice.projectId);
  return board && list ? [`${board.label}/${list.label}`] : [];
}

export function trelloBody(credential: string, choice: Choice): Record<string, unknown> {
  return { tracker: 'trello', credential, boardId: choice.project, project: choice.projectId };
}
