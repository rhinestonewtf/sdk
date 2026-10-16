import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import integrationConfig from '../../../vitest.config.integration'
import unitConfig from '../../../vitest.config.unit'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))

function step(workflow: string, name: string) {
  const block = workflow.split(`      - name: ${name}\n`)[1]
  expect(block, name).toBeDefined()
  return block.split('\n      - name:')[0]
}

describe('full integration bundle wiring', () => {
  it('discovers EVM and Solana while smoke explicitly selects only EVM', () => {
    expect(integrationConfig.test?.include).toEqual([
      'test/integration/scenarios/**/*.itest.ts',
      'test/integration/solana/**/*.itest.ts',
    ])
    expect(integrationConfig.test).toMatchObject({ fileParallelism: false })
    expect(
      unitConfig.test?.include?.every((glob) => glob.endsWith('.test.ts')),
    ).toBe(true)
    expect(manifest.scripts['test:integration']).toBe(
      'vitest --config vitest.config.integration.ts',
    )
    expect(manifest.scripts['test:integration:smoke']).toBe(
      'vitest --config vitest.config.integration.ts test/integration/scenarios/smoke.itest.ts',
    )
    expect(manifest.scripts['test:integration:solana']).toBeUndefined()
  })

  it.each([
    ['.github/workflows/integration-tests.yaml', "env.SUITE == 'all'"],
    ['.github/workflows/release.yaml', "github.ref == 'refs/heads/release'"],
  ])(
    'gates the Solana secret and always uploads sanitized evidence: %s',
    (path, condition) => {
      const workflow = read(path)
      expect(workflow).toContain('group: live-integration-tests')
      expect(workflow).toContain('cancel-in-progress: false')
      expect(workflow).not.toContain('INTEGRATION_SOLANA_TARGET')
      expect(workflow).not.toContain('suite=solana')
      expect(workflow).not.toContain('          - solana\n')
      const full = step(workflow, 'Run all integration tests')
      expect(full).toContain(`if: ${condition}`)
      expect(full).toContain('run: bun run test:integration -- --run')
      expect(full).toMatch(
        /INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY: \$\{\{ secrets\.INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY \}\}/,
      )
      expect(
        workflow.match(/INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY:/g),
      ).toHaveLength(1)
      expect(step(workflow, 'Run smoke integration tests')).not.toContain(
        'SOLANA',
      )
      const upload = step(workflow, 'Upload sanitized Solana report')
      expect(upload).toContain(`if: always() && ${condition}`)
      expect(upload).toContain('path: .scratch/integration/solana-report.json')
      expect(upload).toContain('include-hidden-files: true')
    },
  )

  it('honors describe retry:0 over global retry:2 in the installed Vitest', async () => {
    await mkdir(resolve(root, '.scratch/integration'), { recursive: true })
    const dir = await mkdtemp(resolve(root, '.scratch/integration/retry-'))
    const attempts = resolve(dir, 'attempts')
    try {
      const spec = resolve(dir, 'retry.test.ts')
      const config = resolve(dir, 'vitest.config.ts')
      await writeFile(
        spec,
        `import { appendFileSync } from 'node:fs';\nimport { describe, it } from 'vitest';\ndescribe('no live retries', { retry: 0 }, () => { it('fails once', () => { appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n'); throw new Error('expected offline failure') }) });\n`,
      )
      await writeFile(
        config,
        `export default { test: { include: [${JSON.stringify(spec)}], retry: 2 } };\n`,
      )
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            resolve(root, 'node_modules/vitest/vitest.mjs'),
            '--run',
            '--config',
            config,
          ],
          { cwd: root },
        ),
      ).rejects.toThrow()
      expect(await readFile(attempts, 'utf8')).toBe('attempt\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
