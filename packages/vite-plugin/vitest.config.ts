import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/global-setup.ts'],
    // The plugin is off under Vitest; this package's tests exercise it in process.
    setupFiles: ['./src/unset-vitest.ts'],
    // The first dynamic import of the plugin can take more than 5 s on the shared runner.
    testTimeout: 30_000,
  },
});
