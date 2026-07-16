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
const boundaryTestGlobs = [
  'src/actions/**/*.test.ts',
  'src/smart-sessions/**/*.test.ts',
  'src/utils/**/*.test.ts',
  'test/vectors/**/*.test.ts',
] as const

export default defineConfig({
  test: {
    include: [...testGlobs, ...boundaryTestGlobs],
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
        'src/accounts/legacy.ts',
        'src/config/input.ts',
        'src/config/resolved.ts',
        'src/modules/read-core.ts',
        'src/signing/context.ts',
        ...transitionalLegacyFiles,
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/core',
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
})
