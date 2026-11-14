import { defineConfig } from 'vitest/config';

// cap workers at 2; a default pool (15 workers x ~4 GB) OOM-killed the 31 GB factory host.
export default defineConfig({ test: { maxWorkers: 2 } });
