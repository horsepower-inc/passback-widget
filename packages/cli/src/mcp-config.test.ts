import { describe, expect, it } from 'vitest';
import { mergeMcpConfig } from './mcp-config';

describe('mergeMcpConfig', () => {
  it('creates the config from nothing', () => {
    const result = mergeMcpConfig(undefined);
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.text)).toEqual({
      mcpServers: { passback: { command: 'npx', args: ['passback', 'dev'] } },
    });
  });

  it('creates the config from whitespace only', () => {
    const result = mergeMcpConfig('   \n\t  ');
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.text)).toEqual({
      mcpServers: { passback: { command: 'npx', args: ['passback', 'dev'] } },
    });
  });

  it('writes a command that npx resolves from the project-local install', () => {
    const entry = JSON.parse(mergeMcpConfig(undefined).text).mcpServers.passback;
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['passback', 'dev']);
    expect(entry.command).not.toBe('passback');
  });

  it('adds passback beside the customer servers and keeps other top-level keys', () => {
    const existing = JSON.stringify(
      {
        mcpServers: { custom: { command: 'custom-server', args: [] } },
        otherKey: 'value',
      },
      null,
      2,
    );
    const result = mergeMcpConfig(existing);
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.text)).toEqual({
      mcpServers: {
        custom: { command: 'custom-server', args: [] },
        passback: { command: 'npx', args: ['passback', 'dev'] },
      },
      otherKey: 'value',
    });
    expect(Object.keys(JSON.parse(result.text))).toEqual(['mcpServers', 'otherKey']);
    expect(Object.keys(JSON.parse(result.text).mcpServers)).toEqual(['custom', 'passback']);
  });

  it('leaves the text untouched and reports unchanged when passback is already there', () => {
    const existing = JSON.stringify({
      mcpServers: { passback: { command: 'something-else', args: [] } },
    });
    const result = mergeMcpConfig(existing);
    expect(result).toEqual({ changed: false, text: existing });
  });

  it('ends the text with a newline and indents by two spaces', () => {
    const result = mergeMcpConfig(undefined);
    expect(result.text.endsWith('\n')).toBe(true);
    expect(result.text.startsWith('{\n  "mcpServers"')).toBe(true);
  });

  it('throws invalid .mcp.json for text that is not JSON', () => {
    expect(() => mergeMcpConfig('not json')).toThrow(/^invalid \.mcp\.json:/);
  });

  it('throws invalid .mcp.json when the top level or mcpServers is not an object', () => {
    expect(() => mergeMcpConfig('[]')).toThrow(/^invalid \.mcp\.json:/);
    expect(() => mergeMcpConfig('"a string"')).toThrow(/^invalid \.mcp\.json:/);
    expect(() => mergeMcpConfig(JSON.stringify({ mcpServers: [] }))).toThrow(
      /^invalid \.mcp\.json:/,
    );
  });
});
