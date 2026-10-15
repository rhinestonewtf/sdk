import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const env = loadEnv('', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  process.env[key] ??= value
}

export default defineConfig({
  test: {
    include: ['test/integration/solana/**/*.itest.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    watch: false,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    retry: 0,
    bail: 1,
  },
})
