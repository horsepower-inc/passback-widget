import type { Tracker } from './customer-integration';

export type TrackerTraits = {
  label: string;
  editable: boolean;
  parent: null | 'workspace' | 'cloudId' | 'boardId';
  connect: 'browser' | 'key';
  targets: 'flat' | 'children' | 'nested-only';
};

export const TRACKER_TRAITS = {
  linear: {
    label: 'Linear',
    editable: true,
    parent: null,
    connect: 'browser',
    targets: 'children',
  },
  plane: { label: 'Plane', editable: true, parent: null, connect: 'key', targets: 'flat' },
  github: { label: 'GitHub', editable: true, parent: null, connect: 'browser', targets: 'flat' },
  jira: {
    label: 'Jira',
    editable: true,
    parent: 'cloudId',
    connect: 'browser',
    targets: 'nested-only',
  },
  gitlab: { label: 'GitLab', editable: true, parent: null, connect: 'key', targets: 'flat' },
  'azure-devops': {
    label: 'Azure DevOps',
    editable: true,
    parent: null,
    connect: 'key',
    targets: 'flat',
  },
  trello: {
    label: 'Trello',
    editable: true,
    parent: 'boardId',
    connect: 'key',
    targets: 'nested-only',
  },
  notion: { label: 'Notion', editable: true, parent: null, connect: 'key', targets: 'flat' },
  asana: {
    label: 'Asana',
    editable: true,
    parent: 'workspace',
    connect: 'key',
    targets: 'nested-only',
  },
  clickup: { label: 'ClickUp', editable: true, parent: null, connect: 'key', targets: 'flat' },
} as const satisfies Record<Tracker, TrackerTraits>;
