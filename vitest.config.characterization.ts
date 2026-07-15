import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const env = loadEnv('', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  process.env[key] ??= value
}

export default defineConfig({
  test: {
    include: ['test/characterization/characterization.itest.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    watch: false,
    fileParallelism: false,
  },
})
