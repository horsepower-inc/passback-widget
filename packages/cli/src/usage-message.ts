const COMMANDS = new Set([
  'dev',
  'init',
  'review-pr',
  'pr-check',
  'snapshot',
  'clear',
  'login',
  'whoami',
  'logout',
  'site',
  'connect',
]);

export function usageMessage(error: string): string {
  const firstWord = error.split(/\s/, 1)[0] ?? '';
  if (COMMANDS.has(firstWord)) {
    return `passback: invalid arguments for '${error}'`;
  }
  if (error.startsWith('--')) {
    return `passback: invalid option '${error}'`;
  }
  return `passback: unknown command '${error}'`;
}
