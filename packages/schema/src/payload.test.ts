import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload, PLATFORMS, redact, type Payload } from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, json: JSON.parse(readFileSync(dir + f, 'utf8')) as unknown }));

describe('fixtures/payloads', () => {
  it('every fixture parses', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    for (const { name, json } of fixtures) {
      expect(() => parsePayload(json), name).not.toThrow();
    }
  });

  it('every fixture is at most 50 KB serialized', () => {
    for (const { name, json } of fixtures) {
      expect(JSON.stringify(json).length, name).toBeLessThanOrEqual(50 * 1024);
    }
  });
});

describe('parsePayload', () => {
  it('rejects a payload that is not schemaVersion 1', () => {
    const v2 = { ...(fixtures[0]!.json as object), schemaVersion: 2 };
    expect(() => parsePayload(v2)).toThrow();
  });

  it('parses a payload without intent.category', () => {
    const base = fixtures[0]!.json as Record<string, unknown>;
    const intent = { ...(base.intent as Record<string, unknown>) };
    delete intent.category;
    const payload = { ...base, intent };
    expect(() => parsePayload(payload)).not.toThrow();
  });

  it('parses a payload without code.buildId', () => {
    const base = fixtures[0]!.json as Record<string, unknown>;
    const code = { ...(base.code as Record<string, unknown>) };
    delete code.buildId;
    const payload = { ...base, code };
    expect(() => parsePayload(payload)).not.toThrow();
  });

  it('rejects a null category', () => {
    const base = fixtures[0]!.json as Record<string, unknown>;
    const intent = { ...(base.intent as Record<string, unknown>), category: null };
    const payload = { ...base, intent };
    expect(() => parsePayload(payload)).toThrow();
  });

  it('rejects a null buildId', () => {
    const base = fixtures[0]!.json as Record<string, unknown>;
    const code = { ...(base.code as Record<string, unknown>), buildId: null };
    const payload = { ...base, code };
    expect(() => parsePayload(payload)).toThrow();
  });
});

describe('parsePayload screenshot', () => {
  const shot = {
    id: '0123456789abcdef0123456789abcdef',
    mime: 'image/webp',
    width: 640,
    height: 480,
    bytes: 20480,
    masked: 2,
    url: 'https://storage.example.com/s/0123456789abcdef0123456789abcdef.webp',
  };
  const withShot = (screenshot: unknown) => ({
    ...(fixtures[0]!.json as Record<string, unknown>),
    screenshot,
  });

  it('parses a payload with a screenshot', () => {
    expect(parsePayload(withShot(shot)).screenshot).toEqual(shot);
  });

  it('parses a payload without a screenshot', () => {
    expect(parsePayload(fixtures[0]!.json).screenshot).toBeUndefined();
  });

  it('rejects a screenshot whose id is not 32 hex characters', () => {
    expect(() => parsePayload(withShot({ ...shot, id: 'abc123' }))).toThrow();
    expect(() => parsePayload(withShot({ ...shot, id: 'G'.repeat(32) }))).toThrow();
  });

  it('rejects a null screenshot', () => {
    expect(() => parsePayload(withShot(null))).toThrow();
  });

  it('rejects a screenshot with another mime type', () => {
    expect(() => parsePayload(withShot({ ...shot, mime: 'image/jpeg' }))).toThrow();
  });
});

describe('parsePayload platform', () => {
  const withPlatform = (platform: unknown) => ({
    ...(fixtures[0]!.json as Record<string, unknown>),
    platform,
  });

  it('parses a payload without a platform and leaves the key out', () => {
    expect('platform' in parsePayload(fixtures[0]!.json)).toBe(false);
  });

  it('parses every platform in PLATFORMS', () => {
    for (const platform of PLATFORMS) {
      expect(parsePayload(withPlatform(platform)).platform).toBe(platform);
    }
  });

  it('parses a payload whose platform is a name this version does not list', () => {
    expect(parsePayload(withPlatform('visionos')).platform).toBe('visionos');
  });

  it('rejects a platform that is empty, has an upper-case letter, a space, or more than 32 characters', () => {
    expect(() => parsePayload(withPlatform(''))).toThrow();
    expect(() => parsePayload(withPlatform('Web'))).toThrow();
    expect(() => parsePayload(withPlatform('react native'))).toThrow();
    expect(() => parsePayload(withPlatform('a'.repeat(33)))).toThrow();
  });

  it('rejects a null platform', () => {
    expect(() => parsePayload(withPlatform(null))).toThrow();
  });
});

describe('parsePayload attachments', () => {
  const voice = {
    kind: 'voice',
    id: '0123456789abcdef0123456789abcdef',
    mime: 'audio/webm',
    bytes: 40960,
    durationMs: 6500,
    url: 'https://storage.example.com/a/0123456789abcdef0123456789abcdef.webm',
  };
  const clip = {
    kind: 'clip',
    id: 'fedcba9876543210fedcba9876543210',
    mime: 'video/mp4',
    bytes: 1048576,
    durationMs: 12000,
  };
  const withAttachments = (attachments: unknown) => ({
    ...(fixtures[0]!.json as Record<string, unknown>),
    attachments,
  });

  it('parses a payload with a voice and a clip attachment', () => {
    expect(parsePayload(withAttachments([voice, clip])).attachments).toEqual([voice, clip]);
  });

  it('parses an attachment whose kind this version does not list', () => {
    const snapshot = { ...clip, kind: 'state-snapshot', mime: 'application/json' };
    expect(parsePayload(withAttachments([snapshot])).attachments).toEqual([snapshot]);
  });

  it('parses a payload without attachments and leaves the key out', () => {
    expect('attachments' in parsePayload(fixtures[0]!.json)).toBe(false);
  });

  it('rejects an empty attachments list, a list of nine, and a null list', () => {
    expect(() => parsePayload(withAttachments([]))).toThrow();
    expect(() => parsePayload(withAttachments(Array.from({ length: 9 }, () => voice)))).toThrow();
    expect(() => parsePayload(withAttachments(null))).toThrow();
  });

  it('rejects an attachment whose id is not 32 hex characters, whose bytes is zero, or whose mime has no slash', () => {
    expect(() => parsePayload(withAttachments([{ ...voice, id: 'abc123' }]))).toThrow();
    expect(() => parsePayload(withAttachments([{ ...voice, bytes: 0 }]))).toThrow();
    expect(() => parsePayload(withAttachments([{ ...voice, mime: 'audio' }]))).toThrow();
  });
});

describe('redact', () => {
  const jwt = [
    'ey' + 'JhbGciOiJIUzI1NiJ9',
    'ey' + 'JzdWIiOiIxMjM0In0',
    'Vd5vKq3Qh8r0-ZLQx9mT1w',
  ].join('.');

  it('redact removes authorization, cookie, input values and JWTs', () => {
    const base = parsePayload(fixtures[0]!.json);
    const dirty: Payload = {
      ...base,
      element: {
        ...base.element,
        tag: 'input',
        attrs: { name: 'email', type: 'email', value: 'jane@corp.example' },
        outerHTML: '<input name="email" type="email" value="jane@corp.example">',
      },
      runtime: {
        ...base.runtime,
        props: {
          headers: { Authorization: 'Bearer tok_abc123', cookie: 'sid=s3cr3t' },
          session: jwt,
        },
      },
      timeline: [
        ...base.timeline,
        {
          t: -10,
          kind: 'network',
          url: '/api/me',
          method: 'GET',
          status: 401,
          ms: 12,
          body: `{"authorization":"Bearer tok_abc123","set-cookie":"sid=s3cr3t; HttpOnly","token":"${jwt}"}`,
        },
      ],
    };

    const out = redact(dirty);
    const text = JSON.stringify(out);

    for (const secret of ['tok_abc123', 's3cr3t', 'jane@corp.example', jwt]) {
      expect(text).not.toContain(secret);
    }
    expect(() => parsePayload(out)).not.toThrow();
    expect(out.element.attrs.name).toBe('email');
    expect(JSON.stringify(dirty)).toContain('tok_abc123');
  });

  it('keeps a textarea value out of outerHTML', () => {
    const base = parsePayload(fixtures[0]!.json);
    const out = redact({
      ...base,
      element: {
        ...base.element,
        tag: 'textarea',
        text: 'my home address',
        outerHTML: '<textarea name="a">my home address</textarea>',
      },
    });
    expect(JSON.stringify(out)).not.toContain('my home address');
  });

  it('redacts form values in outerHTML that is trimmed or has ">" in an earlier attribute', () => {
    const base = parsePayload(fixtures[0]!.json);
    const out = redact({
      ...base,
      element: {
        ...base.element,
        tag: 'form',
        outerHTML: '<form><input data-tip="a > b" value="jane@corp.example"><textarea>my home addr',
      },
    });
    const html = out.element.outerHTML;
    expect(html).not.toContain('jane@corp.example');
    expect(html).not.toContain('my home addr');
  });

  it('redacts header values inside escaped JSON', () => {
    const base = parsePayload(fixtures[0]!.json);
    const out = redact({
      ...base,
      timeline: [
        {
          t: -5,
          kind: 'console',
          level: 'error',
          message: 'request failed: {\\"authorization\\":\\"Bearer tok_abc123\\"}',
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain('tok_abc123');
  });
});
