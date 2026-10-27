type RouteContext = { params: Promise<{ path?: string[] }> };

const PUBLIC_FILES = ['widget.js', 'collector.js', 'shot.js'];

function isPublicFile(request: Request, segments: string[]): boolean {
  return request.method === 'GET' && segments.length === 1 && PUBLIC_FILES.includes(segments[0]!);
}

async function answer(request: Request, context: RouteContext): Promise<Response> {
  const segments = (await context.params).path ?? [];
  if (!process.env.PASSBACK_MODE && !isPublicFile(request, segments)) {
    return new Response(null, { status: 404 });
  }
  const [{ handleRequest }, { readWidgetAssets }] = await Promise.all([
    import('./route-core'),
    import('./widget-assets'),
  ]);
  return handleRequest(request, segments, {
    root: process.env.PASSBACK_ROOT ?? process.cwd(),
    assets: () => readWidgetAssets(undefined, Boolean(process.env.PASSBACK_MODE)),
  });
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return answer(request, context);
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return answer(request, context);
}
