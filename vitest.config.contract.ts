import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/contract/**/*.ctest.ts'],
    watch: false,
    fileParallelism: false,
  },
})
