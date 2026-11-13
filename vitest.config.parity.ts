import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [
    {
      // Every module in the parity process gets viem's CommonJS build, the
      // one the published baseline and its CommonJS dependencies load. With
      // two module instances, chain objects compared by identity inside the
      // SDK would differ between the builds.
      name: 'parity-viem-commonjs',
      enforce: 'pre',
      resolveId(source) {
        return /^viem(\/|$)/.test(source) ? require.resolve(source) : null
      },
    },
  ],
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
