import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'scripts/architecture/**/*.test.ts',
      'test/integration/config/**/*.test.ts',
      'test/integration/framework/**/*.test.ts',
      'test/vectors/**/*.test.ts',
    ],
    exclude: ['src/dist/**'],
    watch: false,
  },
})
