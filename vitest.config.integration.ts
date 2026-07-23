import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const env = loadEnv('', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  process.env[key] ??= value
}

export default defineConfig({
  test: {
    include: ['test/integration/scenarios/**/*.itest.ts'],
    // Funded scenarios cold-fund a fresh account and poll the dev orchestrator's
    // portfolio endpoint (seconds to tens of seconds per call, plus indexer lag)
    // before executing on-chain; 180s left no margin under load.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    watch: false,
    fileParallelism: false,
  },
})
