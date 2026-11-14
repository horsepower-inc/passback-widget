import { describe, expect, it } from 'vitest';
import { LOG_LEVELS } from './logger';
import { createMemoryLogger } from './memory-logger';

describe('createMemoryLogger', () => {
  it('records level, message and fields for each call', () => {
    const { logger, records } = createMemoryLogger();
    logger.debug('a', { x: 1 });
    logger.info('b', { x: 2 });
    logger.warn('c', { x: 3 });
    logger.error('d', { x: 4 });

    expect(records).toEqual([
      { level: 'debug', msg: 'a', fields: { x: 1 } },
      { level: 'info', msg: 'b', fields: { x: 2 } },
      { level: 'warn', msg: 'c', fields: { x: 3 } },
      { level: 'error', msg: 'd', fields: { x: 4 } },
    ]);
  });

  it('records an empty fields object when none are given', () => {
    const { logger, records } = createMemoryLogger();
    logger.info('no fields');

    expect(records).toEqual([{ level: 'info', msg: 'no fields', fields: {} }]);
  });

  it('a child logger adds its bindings to every record', () => {
    const { logger, records } = createMemoryLogger();
    const child = logger.child({ batchSeq: 3 });
    child.info('queued');

    expect(records).toEqual([{ level: 'info', msg: 'queued', fields: { batchSeq: 3 } }]);
  });

  it('call fields override child bindings with the same key', () => {
    const { logger, records } = createMemoryLogger();
    const child = logger.child({ status: 'pending' });
    child.info('done', { status: 'complete' });

    expect(records).toEqual([{ level: 'info', msg: 'done', fields: { status: 'complete' } }]);
  });

  it('a grandchild merges bindings from both ancestors', () => {
    const { logger, records } = createMemoryLogger();
    const child = logger.child({ batchSeq: 3 });
    const grandchild = child.child({ markId: 'm_1' });
    grandchild.info('acked');

    expect(records).toEqual([
      { level: 'info', msg: 'acked', fields: { batchSeq: 3, markId: 'm_1' } },
    ]);
  });

  it('a child leaves its parent bindings unchanged', () => {
    const { logger, records } = createMemoryLogger();
    const child = logger.child({ batchSeq: 3 });
    child.info('child event');
    logger.info('parent event');

    expect(records).toEqual([
      { level: 'info', msg: 'child event', fields: { batchSeq: 3 } },
      { level: 'info', msg: 'parent event', fields: {} },
    ]);
  });

  it('parent and child write to the same records list', () => {
    const { logger, records } = createMemoryLogger();
    const child = logger.child({ batchSeq: 3 });
    logger.info('from parent');
    child.info('from child');

    expect(records).toHaveLength(2);
  });

  it('a record keeps its fields when the caller mutates the object afterwards', () => {
    const { logger, records } = createMemoryLogger();
    const fields = { count: 1 };
    logger.info('mutable', fields);
    fields.count = 2;

    expect(records[0]?.fields).toEqual({ count: 1 });
  });

  it('LOG_LEVELS lists the four levels from debug to error', () => {
    expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
  });
});
