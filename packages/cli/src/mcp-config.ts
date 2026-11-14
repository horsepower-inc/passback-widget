export interface MergeMcpConfigResult {
  changed: boolean;
  text: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfig(existing: string | undefined): Record<string, unknown> {
  const trimmed = existing?.trim() ?? '';
  if (trimmed === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing as string);
  } catch {
    throw new Error('invalid .mcp.json: not valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('invalid .mcp.json: top level is not an object');
  }
  if (parsed.mcpServers !== undefined && !isPlainObject(parsed.mcpServers)) {
    throw new Error('invalid .mcp.json: mcpServers is not an object');
  }

  return parsed;
}

/** Pure merge of the passback MCP server entry into an existing `.mcp.json` text. */
export function mergeMcpConfig(existing: string | undefined): MergeMcpConfigResult {
  const parsed = parseConfig(existing);
  const mcpServers = isPlainObject(parsed.mcpServers) ? parsed.mcpServers : {};

  if ('passback' in mcpServers) {
    return { changed: false, text: existing as string };
  }

  const result = {
    ...parsed,
    mcpServers: { ...mcpServers, passback: { command: 'npx', args: ['passback', 'dev'] } },
  };

  return { changed: true, text: JSON.stringify(result, null, 2) + '\n' };
}
