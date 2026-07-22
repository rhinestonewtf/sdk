import type { BuildOptions } from 'esbuild'

const viem = ['viem', 'viem/*']
const packageRoot = process.env.SDK_SIZE_PACKAGE_ROOT ?? './src/dist/src'

const limits = [
  {
    name: '@rhinestone/sdk',
    path: `${packageRoot}/index.js`,
    limit: '58 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/actions',
    path: `${packageRoot}/actions/index.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/actions/ecdsa',
    path: `${packageRoot}/actions/ecdsa.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/actions/mfa',
    path: `${packageRoot}/actions/mfa.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/actions/passkeys',
    path: `${packageRoot}/actions/passkeys.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/signing/passkeys',
    path: `${packageRoot}/signing/passkeys.js`,
    limit: '1 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/actions/smart-sessions',
    path: `${packageRoot}/actions/smart-sessions.js`,
    limit: '27 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/errors',
    path: `${packageRoot}/errors/index.js`,
    limit: '20 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/utils',
    path: `${packageRoot}/utils/index.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/smart-sessions',
    path: `${packageRoot}/smart-sessions/index.js`,
    limit: '25 kB',
    import: '*',
    ignore: viem,
  },
  {
    name: '@rhinestone/sdk/jwt-server',
    path: `${packageRoot}/jwt-server/index.js`,
    limit: '2 kB',
    import: '*',
    ignore: ['express', 'express/*', 'jose', 'jose/*', ...viem],
    modifyEsbuildConfig: (config: BuildOptions): BuildOptions => ({
      ...config,
      format: 'esm',
      platform: 'node',
    }),
  },
]

const selectedEntry = process.env.SDK_SIZE_ENTRY
const selectedLimits = selectedEntry
  ? limits.filter(({ name }) => name === selectedEntry)
  : limits

if (selectedEntry && selectedLimits.length === 0) {
  throw new Error(`Unknown SDK_SIZE_ENTRY: ${selectedEntry}`)
}

export default selectedLimits
