// the route handler's logic as a pure function of a Fetch Request.

import path from 'node:path';
import {
  acceptMark,
  acceptOrphaned,
  acceptReopen,
  acceptVerdict,
  clearInbox,
  FileInboxAdapter,
} from '@passback/adapters/local';
import { ChannelList } from '@passback/schema';
import { guardPost } from './route-guards';
import { readSnapshot } from './snapshot';
import { eventsResponse, getStatusHub } from './status-stream';
import type { WidgetAssets } from './widget-assets';

export type RouteDeps = { root: string; assets: () => WidgetAssets };

const NIL_BATCH_ID = '00000000000000000000000000';
const JS_TYPE = 'text/javascript; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

function serveAsset(file: 'widget' | 'collector' | 'shot', deps: RouteDeps): Response {
  try {
    const bytes = deps.assets()[file];
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': JS_TYPE, 'cache-control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500, headers: { 'content-type': TEXT_TYPE } });
  }
}

function inboxRoot(deps: RouteDeps): string {
  return path.join(deps.root, '.passback', 'inbox');
}

function statusOf(code: string | undefined): number {
  if (code === undefined) return 200;
  return code === 'bad_request' || code === 'payload_too_large' ? 400 : 500;
}

async function handleMark(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    const ack = {
      v: 1,
      batchId: NIL_BATCH_ID,
      accepted: [],
      trimmed: [],
      error: { code: 'bad_request', message: 'body is not valid JSON' },
    };
    return Response.json(ack, { status: 400 });
  }
  const adapter = new FileInboxAdapter({ root: inboxRoot(deps) });
  const ack = await acceptMark(adapter, parsed);
  getStatusHub(deps.root).scheduleItems();
  return Response.json(ack, { status: statusOf(ack.error?.code) });
}

async function handleOrphaned(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    return new Response(null, { status: 400 });
  }
  await acceptOrphaned(inboxRoot(deps), parsed);
  getStatusHub(deps.root).scheduleItems();
  return new Response(null, { status: 204 });
}

async function handleReopen(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    return new Response(null, { status: 400 });
  }
  await acceptReopen(path.join(deps.root, '.passback'), parsed);
  getStatusHub(deps.root).scheduleItems();
  return new Response(null, { status: 204 });
}

async function handleVerdict(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    return new Response(null, { status: 400 });
  }
  await acceptVerdict(path.join(deps.root, '.passback'), parsed);
  return new Response(null, { status: 204 });
}

async function handleClear(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const result = await clearInbox(path.join(deps.root, '.passback'), parsed);
  if (result.ok) {
    getStatusHub(deps.root).scheduleItems();
    return Response.json(result.cleared);
  }
  return new Response(null, { status: result.error === 'invalid' ? 400 : 500 });
}

async function handleList(request: Request, deps: RouteDeps): Promise<Response> {
  const guard = await guardPost(request);
  if (!guard.ok) return guard.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(guard.body);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!ChannelList.safeParse(parsed).success) return new Response(null, { status: 400 });
  try {
    return Response.json(await readSnapshot({ passbackDir: path.join(deps.root, '.passback') }));
  } catch {
    return new Response(null, { status: 500 });
  }
}

export async function handleRequest(
  request: Request,
  segments: readonly string[],
  deps: RouteDeps,
): Promise<Response> {
  const route = segments.join('/');
  const allowed: Record<string, string> = {
    'widget.js': 'GET',
    'collector.js': 'GET',
    'shot.js': 'GET',
    mark: 'POST',
    orphaned: 'POST',
    reopen: 'POST',
    verdict: 'POST',
    clear: 'POST',
    list: 'POST',
    events: 'GET',
  };
  const allow = allowed[route];
  if (allow === undefined) return new Response('not found', { status: 404 });
  if (request.method !== allow) return new Response(null, { status: 405, headers: { allow } });
  if (route === 'widget.js') return serveAsset('widget', deps);
  if (route === 'collector.js') return serveAsset('collector', deps);
  if (route === 'shot.js') return serveAsset('shot', deps);
  if (route === 'events') return eventsResponse(request, getStatusHub(deps.root));
  if (route === 'mark') return handleMark(request, deps);
  if (route === 'list') return handleList(request, deps);
  if (route === 'verdict') return handleVerdict(request, deps);
  if (route === 'clear') return handleClear(request, deps);
  return route === 'reopen' ? handleReopen(request, deps) : handleOrphaned(request, deps);
}
