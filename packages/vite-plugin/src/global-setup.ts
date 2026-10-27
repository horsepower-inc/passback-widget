// Vitest globalSetup: makes sure @passback/widget/dist/passback.js exists before any test file
// runs, so `pnpm test` passes in a fresh worktree without a prior manual widget build.

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function isNonEmptyFile(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

/** Builds `artifact` via `build()` unless it already exists and is non-empty. Throws if the
 * artifact is still missing or empty afterwards. `build` is expected to throw on its own
 * failure (non-zero exit, timeout); this only guards the case where it reports success but
 * leaves nothing on disk. */
export function ensureWidgetArtifact(artifact: string, build: () => void): void {
  if (isNonEmptyFile(artifact)) {
    return;
  }
  build();
  if (!isNonEmptyFile(artifact)) {
    throw new Error(`passback: widget artifact missing after build (${artifact})`);
  }
}

function buildWidget(repoRoot: string): void {
  const result = spawnSync('pnpm', ['--filter', '@passback/widget', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `passback: \`pnpm --filter @passback/widget build\` failed (status ${String(result.status)})`,
    );
  }
}

export default function setup(): void {
  const artifact = fileURLToPath(new URL('../../widget/dist/passback.js', import.meta.url));
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  ensureWidgetArtifact(artifact, () => buildWidget(repoRoot));
  const chunk = fileURLToPath(new URL('../../widget/dist/passback-collect.js', import.meta.url));
  ensureWidgetArtifact(chunk, () => buildWidget(repoRoot));
  const local = fileURLToPath(new URL('../../widget/dist/passback-local.js', import.meta.url));
  ensureWidgetArtifact(local, () => buildWidget(repoRoot));
}
