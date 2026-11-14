// the framework union, single source of truth.

export const FRAMEWORKS = ['react', 'vue', 'svelte', 'unknown'] as const;
export type Framework = (typeof FRAMEWORKS)[number];
