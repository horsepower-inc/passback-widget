import { z } from 'zod';
import { FRAMEWORKS } from './frameworks';

// Additive fields within v1; anything breaking is schemaVersion 2.

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export const Offset = z.object({ x: z.number(), y: z.number() });

export const Code = z.object({
  framework: z.enum(FRAMEWORKS),
  chain: z.array(
    z.object({
      name: z.string(),
      file: z.string().optional(),
      line: z.number().optional(),
      col: z.number().optional(),
      hash: z.string().optional(),
    }),
  ),
  buildId: z.string().optional(),
});

export const Element = z.object({
  selectors: z.array(
    z.object({ kind: z.enum(['testid', 'id', 'role', 'css']), value: z.string() }),
  ),
  tag: z.string(),
  attrs: z.record(z.string(), z.string()),
  text: z.string(),
  outerHTML: z.string(),
});

export const Visual = z.object({
  rects: z.object({
    self: Rect,
    parent: Rect,
    prev: Rect.optional(),
    next: Rect.optional(),
    positioned: Rect.optional(),
  }),
  styles: z.record(z.string(), z.string()),
  flags: z.object({
    clipped: z.boolean(),
    covered: z.boolean(),
    offViewport: z.boolean(),
    contrast: z.number().optional(),
  }),
  text: z
    .object({ lines: z.array(Rect), baseline: z.number(), ascent: z.number(), descent: z.number() })
    .optional(),
});

export const Runtime = z.object({
  props: z.unknown().optional(),
  store: z.unknown().optional(),
  url: z.string(),
  route: z.string(),
  flags: z.record(z.string(), z.boolean()).optional(),
  role: z.string().optional(),
});

export const TimelineEvent = z.discriminatedUnion('kind', [
  z.object({
    t: z.number(),
    kind: z.literal('console'),
    level: z.enum(['error', 'warn']),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({
    t: z.number(),
    kind: z.literal('rejection'),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({
    t: z.number(),
    kind: z.literal('network'),
    url: z.string(),
    method: z.string(),
    status: z.number(),
    ms: z.number(),
    body: z.string().optional(),
  }),
  z.object({ t: z.number(), kind: z.literal('navigation'), from: z.string(), to: z.string() }),
  z.object({
    t: z.number(),
    kind: z.literal('action'),
    type: z.enum(['click', 'input', 'scroll']),
    selector: z.string().optional(),
    delta: z.tuple([z.number(), z.number()]).optional(),
  }),
]);
export const Timeline = z.array(TimelineEvent);

export const Environment = z.object({
  ua: z.string(),
  viewport: z.tuple([z.number(), z.number()]),
  dpr: z.number(),
  locale: z.string(),
  tz: z.string(),
  colorScheme: z.enum(['light', 'dark']),
  reducedMotion: z.boolean(),
  connection: z.string().optional(),
});

const edge = z.enum(['left', 'right', 'top', 'bottom']);
export const Annotation = z.union([
  z.object({
    type: z.literal('align'),
    edge,
    a: z.string(),
    b: z.string(),
    actual: z.object({ a: z.number(), b: z.number() }),
  }),
  z.object({
    type: z.literal('gap'),
    a: z.string(),
    b: z.string(),
    expected: z.number(),
    actual: z.number(),
  }),
  z.object({ type: z.literal('no-overlap'), elements: z.array(z.string()) }),
  z.object({ type: z.literal('move'), element: z.string(), target: z.string() }),
  z.object({
    type: z.enum(['arrow', 'box', 'label']),
    from: Offset.optional(),
    to: Offset.optional(),
    text: z.string().optional(),
  }),
]);

export const Intent = z.object({
  comment: z.string(),
  category: z.enum(['visual', 'functional', 'content', 'perf']).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  annotations: z.array(Annotation),
});

export const Repro = z.object({
  steps: z.array(z.object({ op: z.enum(['goto', 'click', 'wait']), target: z.string() })),
});

// id: 128-bit hex id from the upload route; masked: boxes painted over the crop; url: set only by the relay from its storage URL; the object lives in relay storage, never in the mark.
export const Screenshot = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  mime: z.enum(['image/webp', 'image/png']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  masked: z.number().int().nonnegative(),
  url: z.url().optional(),
});

// A file the relay stored for this mark, by reference; the bytes are never in the mark. kind: 'voice' and 'clip' are known today; url is set only by the relay.
export const MAX_MARK_ATTACHMENTS = 8;
export const MarkAttachment = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  id: z.string().regex(/^[0-9a-f]{32}$/),
  mime: z
    .string()
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/)
    .max(100),
  bytes: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  url: z.url().optional(),
});

// The platforms known today; a reader accepts a name it does not know.
export const PLATFORMS = [
  'web',
  'electron',
  'flutter',
  'rn',
  'unity',
  'godot',
  'unreal',
  'native',
  'screen',
] as const;
export const Platform = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

export const Payload = z.object({
  schemaVersion: z.literal(1),
  platform: Platform.optional(),
  code: Code,
  element: Element,
  visual: Visual,
  runtime: Runtime,
  timeline: Timeline,
  environment: Environment,
  intent: Intent,
  repro: Repro.optional(),
  screenshot: Screenshot.optional(),
  attachments: z.array(MarkAttachment).min(1).max(MAX_MARK_ATTACHMENTS).optional(),
});

export type Rect = z.infer<typeof Rect>;
export type Offset = z.infer<typeof Offset>;
export type Code = z.infer<typeof Code>;
export type Element = z.infer<typeof Element>;
export type Visual = z.infer<typeof Visual>;
export type Runtime = z.infer<typeof Runtime>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type Timeline = z.infer<typeof Timeline>;
export type Environment = z.infer<typeof Environment>;
export type Annotation = z.infer<typeof Annotation>;
export type Intent = z.infer<typeof Intent>;
export type Repro = z.infer<typeof Repro>;
export type Screenshot = z.infer<typeof Screenshot>;
export type MarkAttachment = z.infer<typeof MarkAttachment>;
export type Payload =z.infer<typeof Payload>;
export type Platform = z.infer<typeof Platform>;
export type KnownPlatform = (typeof PLATFORMS)[number];

/** Validates unknown input against the v1 payload schema; throws a ZodError on mismatch. */
export function parsePayload(input: unknown): Payload {
  return Payload.parse(input);
}
