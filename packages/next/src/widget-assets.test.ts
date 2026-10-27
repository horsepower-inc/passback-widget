import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWidgetAssets } from './widget-assets';

describe('readWidgetAssets', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'passback-next-assets-'));
    mkdirSync(join(dir, 'widget'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (widget: string, collector: string, shot = 'shot-bytes') => {
    writeFileSync(join(dir, 'widget', 'passback.js'), widget);
    writeFileSync(join(dir, 'widget', 'passback-collect.js'), collector);
    writeFileSync(join(dir, 'widget', 'passback-shot.js'), shot);
  };
  const from = () => pathToFileURL(join(dir, 'index.js'));

  it('reads the widget and the collector chunk from widget/ next to the module', () => {
    write('widget-bytes', 'collector-bytes');
    const assets = readWidgetAssets(from());
    expect(assets.widget.toString()).toBe('widget-bytes');
    expect(assets.collector.toString()).toBe('collector-bytes');
  });

  it('reads the shot chunk from widget/ next to the module', () => {
    write('widget-bytes', 'collector-bytes', 'shot-chunk-bytes');
    expect(readWidgetAssets(from()).shot.toString()).toBe('shot-chunk-bytes');
  });

  it('reads the local widget build when local is true', () => {
    write('relay-bytes', 'collector-bytes');
    writeFileSync(join(dir, 'widget', 'passback-local.js'), 'local-bytes');
    expect(readWidgetAssets(from()).widget.toString()).toBe('relay-bytes');
    expect(readWidgetAssets(from(), true).widget.toString()).toBe('local-bytes');
  });

  it('re-reads the files on every call', () => {
    write('one', 'uno');
    readWidgetAssets(from());
    write('two', 'dos');
    const assets = readWidgetAssets(from());
    expect(assets.widget.toString()).toBe('two');
    expect(assets.collector.toString()).toBe('dos');
  });
});
