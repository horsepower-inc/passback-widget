import { describe, expect, it } from 'vitest';
import { chooseFormat, createTerminalLogger, levelFor } from './terminal-logger';

const NOW = () => new Date('2026-09-27T12:00:00.000Z');

function collect() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe('createTerminalLogger', () => {
  it('writes a human-readable line with a level symbol in text format', () => {
    const { lines, write } = collect();
    const logger = createTerminalLogger({ write, format: 'text', level: 'info', now: NOW });
    logger.info('mark m_3f2 queued (Header.tsx)');

    expect(lines).toEqual(['✓ mark m_3f2 queued (Header.tsx)\n']);
  });

  it('writes one JSON object per line in json format', () => {
    const { lines, write } = collect();
    const logger = createTerminalLogger({ write, format: 'json', level: 'info', now: NOW });
    logger.info('mark queued', { markId: 'm_3f2' });
    logger.warn('gave up', { key: 'm_9' });

    expect(lines).toEqual([
      `${JSON.stringify({ time: NOW().toISOString(), level: 'info', msg: 'mark queued', markId: 'm_3f2' })}\n`,
      `${JSON.stringify({ time: NOW().toISOString(), level: 'warn', msg: 'gave up', key: 'm_9' })}\n`,
    ]);
  });

  it('chooses text on a TTY and json when stdout is not a TTY or --json is passed', () => {
    expect(chooseFormat({ isTTY: true, json: false })).toBe('text');
    expect(chooseFormat({ isTTY: false, json: false })).toBe('json');
    expect(chooseFormat({ isTTY: true, json: true })).toBe('json');
    expect(chooseFormat({ isTTY: false, json: true })).toBe('json');
  });

  it('drops debug at the default info level and keeps it with --verbose', () => {
    expect(levelFor({ verbose: false })).toBe('info');
    expect(levelFor({ verbose: true })).toBe('debug');

    const { lines, write } = collect();
    const logger = createTerminalLogger({
      write,
      format: 'text',
      level: levelFor({ verbose: false }),
      now: NOW,
    });
    logger.debug('should not appear');
    expect(lines).toEqual([]);

    const verboseLogger = createTerminalLogger({
      write,
      format: 'text',
      level: levelFor({ verbose: true }),
      now: NOW,
    });
    verboseLogger.debug('should appear');
    expect(lines).toEqual(['· should appear\n']);
  });

  it('redacts secret-named fields in both formats', () => {
    const text = collect();
    const textLogger = createTerminalLogger({
      write: text.write,
      format: 'text',
      level: 'info',
      now: NOW,
    });
    textLogger.info('login', { apiKey: 'abc123', userId: 42 });
    expect(text.lines).toEqual(['✓ login apiKey=[redacted] userId=42\n']);

    const json = collect();
    const jsonLogger = createTerminalLogger({
      write: json.write,
      format: 'json',
      level: 'info',
      now: NOW,
    });
    jsonLogger.info('login', { authorization: 'Bearer xyz', userId: 42 });
    expect(json.lines).toEqual([
      `${JSON.stringify({
        time: NOW().toISOString(),
        level: 'info',
        msg: 'login',
        authorization: '[redacted]',
        userId: 42,
      })}\n`,
    ]);
  });

  it('a child adds its bindings in both formats', () => {
    const text = collect();
    const textLogger = createTerminalLogger({
      write: text.write,
      format: 'text',
      level: 'info',
      now: NOW,
    });
    textLogger.child({ batchSeq: 3 }).info('acked');
    expect(text.lines).toEqual(['✓ acked batchSeq=3\n']);

    const json = collect();
    const jsonLogger = createTerminalLogger({
      write: json.write,
      format: 'json',
      level: 'info',
      now: NOW,
    });
    jsonLogger.child({ batchSeq: 3 }).info('acked');
    expect(json.lines).toEqual([
      `${JSON.stringify({ time: NOW().toISOString(), level: 'info', msg: 'acked', batchSeq: 3 })}\n`,
    ]);
  });

  it('keeps time, level and msg when a field or binding uses those names', () => {
    const json = collect();
    const jsonLogger = createTerminalLogger({
      write: json.write,
      format: 'json',
      level: 'info',
      now: NOW,
    });
    jsonLogger.child({ level: 'x' }).error('boom', { msg: 'y', time: 'z' });

    expect(json.lines).toEqual([
      `${JSON.stringify({
        time: NOW().toISOString(),
        level: 'error',
        msg: 'boom',
        'field.level': 'x',
        'field.msg': 'y',
        'field.time': 'z',
      })}\n`,
    ]);
  });

  it('keeps both values when a field is named level and another field.level', () => {
    const json = collect();
    const jsonLogger = createTerminalLogger({
      write: json.write,
      format: 'json',
      level: 'info',
      now: NOW,
    });
    jsonLogger.info('go', { level: 'a', 'field.level': 'b' });

    expect(JSON.parse(json.lines[0]!)).toEqual({
      time: NOW().toISOString(),
      level: 'info',
      msg: 'go',
      'field.level': 'a',
      'field.field.level': 'b',
    });
  });

  it('escapes a field key that already starts with the escape prefix', () => {
    const json = collect();
    const jsonLogger = createTerminalLogger({
      write: json.write,
      format: 'json',
      level: 'info',
      now: NOW,
    });
    jsonLogger.child({ 'field.x': 1 }).info('go', { x: 2 });

    expect(JSON.parse(json.lines[0]!)).toEqual({
      time: NOW().toISOString(),
      level: 'info',
      msg: 'go',
      'field.field.x': 1,
      x: 2,
    });
  });
});
