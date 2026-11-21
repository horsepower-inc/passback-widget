import type { LogFields, LogLevel, Logger } from '../core/logger';
import { LOG_LEVELS } from '../core/logger';

export type LogFormat = 'text' | 'json';

const REDACT_PATTERN = /token|secret|passw(or)?d|api[-_]?key|authorization|cookie|credential/i;

const SYMBOLS: Record<LogLevel, string> = {
  debug: '·',
  info: '✓',
  warn: '!',
  error: '✗',
};

function redactFields(fields: LogFields): LogFields {
  const redacted: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = REDACT_PATTERN.test(key) ? '[redacted]' : value;
  }
  return redacted;
}

function formatText(level: LogLevel, msg: string, fields: LogFields): string {
  let line = `${SYMBOLS[level]} ${msg}`;
  for (const [key, value] of Object.entries(fields)) {
    line += ` ${key}=${value}`;
  }
  return `${line}\n`;
}

const RESERVED_KEYS = new Set(['time', 'level', 'msg']);
const ESCAPE_PREFIX = 'field.';

function escapeReservedKeys(fields: LogFields): LogFields {
  const escaped: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const needsEscape = RESERVED_KEYS.has(key) || key.startsWith(ESCAPE_PREFIX);
    escaped[needsEscape ? `${ESCAPE_PREFIX}${key}` : key] = value;
  }
  return escaped;
}

function formatJson(level: LogLevel, msg: string, fields: LogFields, now: () => Date): string {
  return `${JSON.stringify({ time: now().toISOString(), level, msg, ...escapeReservedKeys(fields) })}\n`;
}

export function chooseFormat(opts: { isTTY: boolean; json: boolean }): LogFormat {
  return opts.json || !opts.isTTY ? 'json' : 'text';
}

export function levelFor(opts: { verbose: boolean }): LogLevel {
  return opts.verbose ? 'debug' : 'info';
}

function createLogger(
  bindings: LogFields,
  opts: { write: (line: string) => void; format: LogFormat; level: LogLevel; now: () => Date },
): Logger {
  const minIndex = LOG_LEVELS.indexOf(opts.level);

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LOG_LEVELS.indexOf(level) < minIndex) return;
    const merged = redactFields({ ...bindings, ...fields });
    opts.write(
      opts.format === 'text'
        ? formatText(level, msg, merged)
        : formatJson(level, msg, merged, opts.now),
    );
  };

  return {
    debug(msg, fields) {
      emit('debug', msg, fields);
    },
    info(msg, fields) {
      emit('info', msg, fields);
    },
    warn(msg, fields) {
      emit('warn', msg, fields);
    },
    error(msg, fields) {
      emit('error', msg, fields);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings }, opts);
    },
  };
}

export function createTerminalLogger(opts: {
  write: (line: string) => void;
  format: LogFormat;
  level: LogLevel;
  now: () => Date;
}): Logger {
  return createLogger({}, opts);
}
