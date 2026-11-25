// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cropRect, encodeWithinCap } from './shot-encode';

const vp = { width: 1280, height: 720 };

function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('cropRect', () => {
  it('pads the element by 24 px and keeps the crop inside the viewport', () => {
    expect(cropRect({ x: 100, y: 50, width: 200, height: 100 }, vp)).toEqual({
      x: 76,
      y: 26,
      width: 248,
      height: 148,
    });
    expect(cropRect({ x: 10, y: 5, width: 50, height: 20 }, vp)).toEqual({
      x: 0,
      y: 0,
      width: 84,
      height: 49,
    });
  });

  it('limits the crop to 1200 by 800 CSS pixels', () => {
    const big = { width: 2560, height: 1600 };
    expect(cropRect({ x: 0, y: 0, width: 2000, height: 1500 }, big)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
  });

  it('rounds the crop outward to whole pixels', () => {
    expect(cropRect({ x: 100.4, y: 100.6, width: 10.2, height: 10.2 }, vp)).toEqual({
      x: 76,
      y: 76,
      width: 59,
      height: 59,
    });
  });

  it('returns undefined when the element is not on screen', () => {
    expect(cropRect({ x: 2000, y: 10, width: 50, height: 50 }, vp)).toBeUndefined();
  });
});

describe('encodeWithinCap', () => {
  it('takes the first encoding under the cap, highest quality first', async () => {
    const calls: Array<[number, number]> = [];
    const result = await encodeWithinCap(async (q, s) => {
      calls.push([q, s]);
      return blobOf(q === 0.8 ? 200 : 50, 'image/webp');
    }, 100);
    expect(calls).toEqual([
      [0.8, 1],
      [0.65, 1],
    ]);
    expect(result).toMatchObject({ mime: 'image/webp', quality: 0.65, scale: 1 });
  });

  it('halves the size once and tries the qualities again when none fits', async () => {
    const calls: Array<[number, number]> = [];
    const result = await encodeWithinCap(async (q, s) => {
      calls.push([q, s]);
      return blobOf(s === 1 ? 200 : 50, 'image/webp');
    }, 100);
    expect(calls).toEqual([
      [0.8, 1],
      [0.65, 1],
      [0.5, 1],
      [0.8, 0.5],
    ]);
    expect(result).toMatchObject({ quality: 0.8, scale: 0.5 });
  });

  it('skips the remaining qualities when the browser answers with a png', async () => {
    const calls: Array<[number, number]> = [];
    const result = await encodeWithinCap(async (q, s) => {
      calls.push([q, s]);
      return blobOf(s === 1 ? 200 : 50, 'image/png');
    }, 100);
    expect(calls).toEqual([
      [0.8, 1],
      [0.8, 0.5],
    ]);
    expect(result).toMatchObject({ mime: 'image/png', scale: 0.5 });
  });

  it('returns undefined when nothing fits under the cap', async () => {
    const calls: Array<[number, number]> = [];
    const result = await encodeWithinCap(async (q, s) => {
      calls.push([q, s]);
      return q === 0.5 ? null : blobOf(200, 'image/jpeg');
    }, 100);
    expect(calls).toHaveLength(6);
    expect(result).toBeUndefined();
  });
});
