import { defineConfig } from 'vitest/config'
import { transitionalLegacyFiles } from './scripts/architecture/legacy-files'

const coreDirectories = [
  'accounts',
  'calls',
  'chains',
  'config',
  'modules',
  'signing',
  'transactions',
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
        'src/accounts/error.ts',
        'src/accounts/legacy.ts',
        'src/config/account.ts',
        'src/config/input.ts',
        'src/config/resolved.ts',
        'src/modules/read-core.ts',
        'src/modules/validators/policies/claim/permit2.ts',
        'src/signing/context.ts',
        'src/signing/execute.ts',
        'src/signing/signers/compatibility.ts',
        'src/signing/signers/ecdsa.ts',
        'src/signing/signers/registry.ts',
        'src/signing/signers/wallet-chain.ts',
        'src/signing/signers/webauthn.ts',
        'src/transactions/intents/prepare.ts',
        'src/transactions/intents/send.ts',
        'src/transactions/intents/session-signing.ts',
        'src/transactions/intents/sessions.ts',
        'src/transactions/intents/sign-transaction.ts',
        'src/transactions/intents/split.ts',
        'src/transactions/intents/status.ts',
        'src/transactions/intents/submit.ts',
        'src/transactions/user-operations/prepare.ts',
        'src/transactions/user-operations/send.ts',
        'src/transactions/user-operations/sign.ts',
        'src/transactions/user-operations/submit.ts',
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
