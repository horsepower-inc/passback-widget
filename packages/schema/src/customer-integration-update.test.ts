import { describe, expect, it } from 'vitest';
import * as entry from './index';
import { CustomerError, CustomerErrorCode, UpdateIntegration } from './customer';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const TRELLO = 'a'.repeat(24);

const bodies = {
  linear: { tracker: 'linear', project: 'WEB' },
  plane: { tracker: 'plane', project: 'P1' },
  github: { tracker: 'github', project: 'acme/web' },
  jira: { tracker: 'jira', cloudId: UUID, project: 'WEB' },
  'azure-devops': { tracker: 'azure-devops', project: UUID },
  gitlab: { tracker: 'gitlab', project: 'group/app' },
  trello: { tracker: 'trello', boardId: TRELLO, project: TRELLO },
  notion: { tracker: 'notion', project: UUID },
} as const;

const ok = (v: unknown) => UpdateIntegration.safeParse(v).success;

describe('UpdateIntegration', () => {
  it('UpdateIntegration accepts a Linear target', () => {
    expect(ok(bodies.linear)).toBe(true);
    expect(ok({ ...bodies.linear, projectId: 'abc' })).toBe(true);
    expect(UpdateIntegration.parse(bodies.linear)).toEqual(bodies.linear);
  });

  it('UpdateIntegration accepts a Plane target', () => {
    expect(ok(bodies.plane)).toBe(true);
    expect(ok({ ...bodies.plane, intake: true })).toBe(true);
    expect(ok({ ...bodies.plane, intake: false })).toBe(true);
    expect(UpdateIntegration.parse(bodies.plane)).toEqual(bodies.plane);
  });

  it('UpdateIntegration accepts a GitHub target', () => {
    expect(ok(bodies.github)).toBe(true);
  });

  it('UpdateIntegration accepts a Jira target', () => {
    expect(ok(bodies.jira)).toBe(true);
  });

  it('UpdateIntegration accepts an Azure DevOps target', () => {
    const b = bodies['azure-devops'];
    expect(ok(b)).toBe(true);
    expect(ok({ ...b, workItemType: 'Bug' })).toBe(true);
    expect(ok({ ...b, workItemType: 'Task' })).toBe(true);
    expect(UpdateIntegration.parse(b)).toEqual(b);
  });

  it('UpdateIntegration accepts a GitLab target', () => {
    expect(ok(bodies.gitlab)).toBe(true);
    expect(ok({ ...bodies.gitlab, project: '12345' })).toBe(true);
  });

  it('UpdateIntegration accepts a Trello target', () => {
    expect(ok(bodies.trello)).toBe(true);
  });

  it('UpdateIntegration accepts a Notion target', () => {
    expect(ok(bodies.notion)).toBe(true);
  });

  it('UpdateIntegration refuses a body that carries a credential', () => {
    for (const body of Object.values(bodies)) {
      expect(ok({ ...body, credential: 'secret_key_1' })).toBe(false);
    }
  });

  it('UpdateIntegration refuses a Plane body that names a workspace or an address', () => {
    expect(ok({ ...bodies.plane, workspace: 'acme' })).toBe(false);
    expect(ok({ ...bodies.plane, planeUrl: 'https://plane.example.com' })).toBe(false);
    expect(ok({ ...bodies.plane, gitlabUrl: 'https://gitlab.example.com' })).toBe(false);
  });

  it('UpdateIntegration refuses non-target fields on every variant', () => {
    const extras = {
      workspace: 'acme',
      planeUrl: 'https://plane.example.com',
      gitlabUrl: 'https://gitlab.example.com',
      siteUrl: 'https://example.com',
      sink: 'github-pr',
      newTracker: 'linear',
      unknown: 1,
    };
    for (const body of Object.values(bodies)) {
      for (const [k, v] of Object.entries(extras)) {
        expect(ok({ ...body, [k]: v }), `${body.tracker} + ${k}`).toBe(false);
      }
    }
  });

  it('UpdateIntegration refuses missing and invalid target fields', () => {
    // each required field omitted
    for (const body of Object.values(bodies)) {
      for (const key of Object.keys(body).filter((k) => k !== 'tracker')) {
        const rest: Record<string, unknown> = { ...body };
        delete rest[key];
        expect(ok(rest), `${body.tracker} - ${key}`).toBe(false);
      }
    }
    // validator boundaries
    expect(ok({ ...bodies.linear, project: '' })).toBe(false);
    expect(ok({ ...bodies.linear, project: 'x'.repeat(129) })).toBe(false);
    expect(ok({ ...bodies.linear, project: 'x'.repeat(128) })).toBe(true);
    expect(ok({ ...bodies.linear, projectId: '' })).toBe(false);
    expect(ok({ ...bodies.plane, project: '' })).toBe(false);
    expect(ok({ ...bodies.plane, intake: 'yes' })).toBe(false);
    expect(ok({ ...bodies.github, project: 'acme' })).toBe(false);
    expect(ok({ ...bodies.github, project: 'a/b/c' })).toBe(false);
    expect(ok({ ...bodies.jira, cloudId: 'nope' })).toBe(false);
    expect(ok({ ...bodies.jira, project: 'web' })).toBe(false);
    expect(ok({ ...bodies.jira, project: 'W' })).toBe(false);
    expect(ok({ ...bodies['azure-devops'], project: 'nope' })).toBe(false);
    expect(ok({ ...bodies['azure-devops'], workItemType: 'Epic' })).toBe(false);
    expect(ok({ ...bodies.gitlab, project: 'group' })).toBe(false);
    expect(ok({ ...bodies.trello, boardId: 'short' })).toBe(false);
    expect(ok({ ...bodies.trello, project: 'Z'.repeat(24) })).toBe(false);
    expect(ok({ ...bodies.notion, project: 'nope' })).toBe(false);
    // fields belonging only to another variant
    expect(ok({ ...bodies.linear, cloudId: UUID })).toBe(false);
    expect(ok({ ...bodies.github, boardId: TRELLO })).toBe(false);
    expect(ok({ ...bodies.jira, intake: true })).toBe(false);
    expect(ok({ ...bodies.plane, workItemType: 'Bug' })).toBe(false);
    expect(ok({ ...bodies.notion, projectId: 'abc' })).toBe(false);
  });

  it('UpdateIntegration accepts an Asana workspace and project', () => {
    expect(ok({ tracker: 'asana', workspace: '1201', project: '1202' })).toBe(true);
  });

  it('UpdateIntegration refuses an Asana body with a credential, a missing field or a non-numeric id', () => {
    expect(ok({ tracker: 'asana', workspace: '1201', project: '1202', credential: 'x' })).toBe(
      false,
    );
    expect(ok({ tracker: 'asana', project: '1202' })).toBe(false);
    expect(ok({ tracker: 'asana', workspace: '1201' })).toBe(false);
    expect(ok({ tracker: 'asana', workspace: 'abc', project: '1202' })).toBe(false);
    expect(ok({ tracker: 'asana', workspace: '1201', project: 'abc' })).toBe(false);
  });

  it('UpdateIntegration accepts a ClickUp list', () => {
    const body = { tracker: 'clickup', project: '901' };
    expect(ok(body)).toBe(true);
    expect(UpdateIntegration.parse(body)).toEqual(body);
  });

  it('UpdateIntegration refuses a ClickUp body with a credential, an extra field, a missing list or a non-numeric id', () => {
    expect(ok({ tracker: 'clickup', project: '901', credential: 'x' })).toBe(false);
    expect(ok({ tracker: 'clickup', project: '901', workspace: '1' })).toBe(false);
    expect(ok({ tracker: 'clickup' })).toBe(false);
    expect(ok({ tracker: 'clickup', project: 'abc' })).toBe(false);
  });

  it('UpdateIntegration refuses an unknown tracker and a body with no tracker', () => {
    expect(ok({ tracker: 'bitbucket', project: 'x' })).toBe(false);
    expect(ok({ project: 'WEB' })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('CustomerErrorCode names not_editable and tracker_changed', () => {
    const opts = CustomerErrorCode.options;
    expect(opts.indexOf('not_editable')).toBe(opts.indexOf('intake_not_enabled') + 1);
    expect(opts.indexOf('tracker_changed')).toBe(opts.indexOf('not_editable') + 1);
    for (const code of ['not_editable', 'tracker_changed']) {
      expect(CustomerErrorCode.safeParse(code).success).toBe(true);
      expect(CustomerError.safeParse({ code }).success).toBe(true);
    }
    expect(CustomerErrorCode.safeParse('nope').success).toBe(false);
    expect(CustomerError.safeParse({ code: 'nope' }).success).toBe(false);
  });

  it('UpdateIntegration is exported from the package entry point', () => {
    expect(entry.UpdateIntegration).toBe(UpdateIntegration);
    const typed: entry.UpdateIntegration = { tracker: 'github', project: 'acme/web' };
    expect(entry.UpdateIntegration.parse(typed)).toEqual(typed);
  });
});
