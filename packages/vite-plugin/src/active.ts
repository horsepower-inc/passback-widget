export function isActive(
  env: { command: 'serve' | 'build'; mode: string },
  stagingModes: readonly string[],
): boolean {
  if (env.command === 'serve') return true;
  return stagingModes.includes(env.mode);
}

export function isTestRun(
  env: { mode: string },
  processEnv: Record<string, string | undefined>,
): boolean {
  return env.mode === 'test' || (processEnv.VITEST ?? '') !== '';
}

export function outsideStagingMessage(buildMode: string): string {
  return `passback: the build mode "${buildMode}" is not in stagingModes, so this build carries no widget. List "${buildMode}" in stagingModes to collect feedback there.`;
}
