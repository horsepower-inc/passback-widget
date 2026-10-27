import type { LogFields, LogLevel, Logger } from './logger';

export type LogRecord = { level: LogLevel; msg: string; fields: LogFields };

function createLogger(bindings: LogFields, records: LogRecord[]): Logger {
  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    records.push({ level, msg, fields: { ...bindings, ...fields } });
  };

  return {
    debug(msg, fields) {
      write('debug', msg, fields);
    },
    info(msg, fields) {
      write('info', msg, fields);
    },
    warn(msg, fields) {
      write('warn', msg, fields);
    },
    error(msg, fields) {
      write('error', msg, fields);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings }, records);
    },
  };
}

export function createMemoryLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { logger: createLogger({}, records), records };
}
