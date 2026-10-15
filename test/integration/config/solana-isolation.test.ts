import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import integrationConfig from '../../../vitest.config.integration'
import solanaConfig from '../../../vitest.config.integration-solana'
import unitConfig from '../../../vitest.config.unit'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))
const workflow = read('.github/workflows/integration-tests.yaml')
const release = read('.github/workflows/release.yaml')

describe('Solana live suite remains opt-in', () => {
  it('discovers only its own live directory', () => {
    expect(solanaConfig.test?.include).toEqual([
      'test/integration/solana/**/*.itest.ts',
    ])
    expect(integrationConfig.test?.include).toEqual([
      'test/integration/scenarios/**/*.itest.ts',
    ])
    expect(
      unitConfig.test?.include?.every((glob) => glob.endsWith('.test.ts')),
    ).toBe(true)
  })

  it('has bounded serial execution and no retries even in CI', () => {
    expect(solanaConfig.test).toMatchObject({
      testTimeout: 300_000,
      hookTimeout: 300_000,
      watch: false,
      fileParallelism: false,
      maxWorkers: 1,
      sequence: { concurrent: false },
      retry: 0,
      bail: 1,
    })
  })

  it('preserves existing all/smoke commands and adds a separate command', () => {
    expect(manifest.scripts['test:integration']).toBe(
      'vitest --config vitest.config.integration.ts',
    )
    expect(manifest.scripts['test:integration:smoke']).toBe(
      'vitest --config vitest.config.integration.ts test/integration/scenarios/smoke.itest.ts',
    )
    expect(manifest.scripts['test:integration:solana']).toBe(
      'vitest --config vitest.config.integration-solana.ts',
    )
  })

  it('keeps pinned Solana tooling out of the published dependency lists', () => {
    const published = JSON.parse(read('src/package.json'))
    for (const name of [
      '@solana/web3.js',
      '@solana/spl-token',
      '@swig-wallet/classic',
    ]) {
      expect(manifest.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/)
      expect(manifest.dependencies[name]).toBeUndefined()
      expect(published.dependencies?.[name]).toBeUndefined()
      expect(published.peerDependencies?.[name]).toBeUndefined()
      expect(published.optionalDependencies?.[name]).toBeUndefined()
    }
  })

  it('exposes Solana only via a bounded, explicitly selected manual step', () => {
    expect(workflow).toContain('          - solana\n')
    expect(workflow).toContain('  workflow_dispatch:')
    expect(workflow).toContain(
      '  group: live-integration-tests\n  cancel-in-progress: false',
    )
    expect(workflow).toContain('    timeout-minutes: 30')
    const solanaStep = workflow.slice(
      workflow.indexOf('      - name: Run Solana integration tests'),
    )
    expect(solanaStep).toContain("if: env.SUITE == 'solana'")
    expect(solanaStep).toContain('timeout-minutes: 25')
    expect(solanaStep).toMatch(
      /INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY: \$\{\{ secrets\.INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY \}\}/,
    )
    expect(solanaStep).toContain(
      'run: bun run test:integration:solana -- --run',
    )
    expect(
      workflow.match(/secrets\.INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY/g),
    ).toHaveLength(1)
    expect(
      workflow.slice(
        0,
        workflow.indexOf('      - name: Run Solana integration tests'),
      ),
    ).not.toContain('INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY')
    expect(solanaStep).not.toMatch(/retry|continue-on-error/)
  })

  it('retains only sanitized reconciliation evidence even on failure', () => {
    const upload = workflow.slice(
      workflow.indexOf('      - name: Upload sanitized Solana report'),
    )
    expect(upload).toContain("if: always() && env.SUITE == 'solana'")
    expect(upload).toContain('path: .scratch/rhi-7365/solana-report.json')
    expect(upload).toContain('include-hidden-files: true')
    expect(upload).toContain('retention-days: 7')
    expect(upload).not.toContain('INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY')
  })

  it('selects target explicitly without credential fallback', () => {
    expect(workflow).toContain(
      'echo "INTEGRATION_SOLANA_TARGET=$TARGET" >> "$GITHUB_ENV"',
    )
    expect(workflow).toContain('if [ -z "$DEV_API_KEY" ]; then')
    expect(workflow).toContain('if [ -z "$PROD_API_KEY" ]; then')
    expect(workflow).toContain(
      'echo "INTEGRATION_RHINESTONE_API_KEY=$DEV_API_KEY" >> "$GITHUB_ENV"',
    )
    expect(workflow).not.toMatch(/\$\{\{[^\n]*(?:&&|\|\|)[^\n]*secrets\./)
  })

  it('leaves release gates and existing EVM config independent of Solana secrets', () => {
    expect(release).not.toMatch(/solana/i)
    expect(release).toContain('test:integration:smoke')
    expect(release).toContain('test:integration')
    for (const path of [
      'test/integration/config/environment.ts',
      'vitest.config.integration.ts',
      'vitest.config.unit.ts',
    ]) {
      expect(read(path)).not.toMatch(/INTEGRATION_SOLANA_|config\/solana/)
    }
  })
})
