import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/parity/scenarios/**/*.parity.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    watch: false,
    retry: 0,
    globalSetup: ['test/parity/global-setup.ts'],
    setupFiles: ['test/parity/setup.ts'],
  },
})
