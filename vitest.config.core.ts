import { defineConfig } from 'vitest/config'
import { transitionalLegacyFiles } from './scripts/architecture/legacy-files'

const coreDirectories = [
  'accounts',
  'calls',
  'chains',
  'config',
  'intents',
  'modules',
  'signing',
  'user-operations',
] as const

const sourceGlobs = coreDirectories.map(
  (directory) => `src/${directory}/**/*.ts`,
)
const testGlobs = coreDirectories.map(
  (directory) => `src/${directory}/**/*.test.ts`,
)

export default defineConfig({
  test: {
    include: testGlobs,
    exclude: ['src/dist/**'],
    passWithNoTests: true,
    watch: false,
    coverage: {
      provider: 'v8',
      include: sourceGlobs,
      exclude: [
        '**/*.test.ts',
        '**/types.ts',
        '**/port.ts',
        'src/accounts/adapter.ts',
        'src/config/input.ts',
        'src/config/resolved.ts',
        'src/signing/context.ts',
        ...transitionalLegacyFiles,
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/core',
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
})
