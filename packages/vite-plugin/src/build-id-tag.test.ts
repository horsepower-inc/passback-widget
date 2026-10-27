import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { buildIdTag } from './build-id-tag';
import { hotBridgeSrc, hotBridgeTag } from './hot-bridge';
import { passback } from './plugin';
import { serveWidgetSrc, widgetTag } from './widget-bundle';
import { serveChunkSrc, withChunkSrc } from './widget-chunk';

type ConfigResolvedFn = (config: ResolvedConfig) => void;
type TransformIndexHtmlFn = (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[];

const NO_CTX = {} as IndexHtmlTransformContext;

function tempRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'passback-')));
}

function gitRoot(): string {
  const root = tempRoot();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'file.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

describe('buildIdTag', () => {
  it('injects a script that sets window.__passback.buildId', () => {
    const tag = buildIdTag('abc1234');
    expect(tag.tag).toBe('script');
    expect(tag.injectTo).toBe('head-prepend');
    expect(tag.children).toBe(
      'window.__passback=Object.assign(window.__passback||{},{buildId:"abc1234"});',
    );
  });

  it('keeps existing window.__passback config keys', () => {
    const tag = buildIdTag('abc1234');
    const fakeWindow: { __passback?: Record<string, unknown> } = { __passback: { theme: 'x' } };
    const run = new Function('window', tag.children as string);
    run(fakeWindow);
    expect(fakeWindow.__passback).toEqual({ theme: 'x', buildId: 'abc1234' });
  });

  it('escapes a build id that contains a closing script tag', () => {
    const tag = buildIdTag('</script><script>alert(1)</script>');
    expect(tag.children).not.toContain('</script>');
    expect(tag.children).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');
  });
});

describe('passback transformIndexHtml', () => {
  it('injects the widget without a build id when git metadata is absent', () => {
    const plugin = passback();
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root: tempRoot(), command: 'serve' } as ResolvedConfig);

    const transformIndexHtml = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
    expect(transformIndexHtml('', NO_CTX)).toEqual([
      hotBridgeTag(hotBridgeSrc('/')),
      withChunkSrc(widgetTag(serveWidgetSrc('/')), serveChunkSrc('/')),
    ]);
  });

  it('uses the buildId plugin option before the widget script', () => {
    const plugin = passback({ buildId: 'option-id' });
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root: gitRoot(), command: 'serve' } as ResolvedConfig);

    const transformIndexHtml = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
    expect(transformIndexHtml('', NO_CTX)).toEqual([
      buildIdTag('option-id'),
      hotBridgeTag(hotBridgeSrc('/')),
      withChunkSrc(widgetTag(serveWidgetSrc('/')), serveChunkSrc('/')),
    ]);
  });
});
