import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['../vite-plugin/src/global-setup.ts'],
  },
});
