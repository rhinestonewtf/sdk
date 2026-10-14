import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compare } from './api-compat.fixture.ts'
import {
  assignabilityFixture,
  consumerFixtures,
  detectPackageGeneration,
} from './generation.ts'
import {
  declaredSdkBump,
  declaresSurfaceChange,
  runCommand,
  writeJson,
} from './shared.ts'

function manifest(version: string, entries: string[]) {
  return {
    version,
    exports: Object.fromEntries(
      entries.map((entry) => [
        entry,
        { types: './index.d.ts', import: './index.js' },
      ]),
    ),
  }
}

const v2 = ['.', './utils']
const v3 = ['.', './evm', './solana']

describe('contract generation selection', () => {
  it.each(['2.16.1', '3.0.0-rc.0', '3.0.0', '0.0.0-dev-snapshot'])(
    'uses exports rather than %s to identify v3',
    (version) => {
      expect(detectPackageGeneration(manifest(version, v3))).toBe('v3')
      expect(consumerFixtures('v3')).toEqual([
        'consumer.ts',
        'current-consumer.ts',
      ])
      expect(assignabilityFixture('v3', 'v3')).toBe('assignability.ts')
    },
  )

  it('retains historical consumers and literals only for v2', () => {
    expect(detectPackageGeneration(manifest('2.17.1', v2))).toBe('v2')
    expect(consumerFixtures('v2')).toEqual(['legacy-consumer.ts'])
    expect(assignabilityFixture('v2', 'v2')).toBe('assignability-v2.ts')
  })

  it.each([
    [],
    ['.'],
    ['.', './evm'],
    ['.', './solana'],
    [...v3, './utils'],
    [...v2, './evm'],
    [...v2, './solana'],
  ])('rejects unknown or ambiguous exports %j', (...entries) => {
    expect(() => detectPackageGeneration(manifest('3.0.0', entries))).toThrow(
      'Unknown or ambiguous',
    )
  })

  it('does not grant cross-generation patch permission', () => {
    expect(() => assignabilityFixture('v2', 'v3')).toThrow('surface changeset')
  })
})

describe('changesets remain compatibility authority', () => {
  it('preserves full semantic checks for branded v3 transaction types', () => {
    const brand =
      'declare const brand: unique symbol; type SolanaAddress = string & { readonly [brand]: true }; '
    const transaction =
      'export type Transaction = { destination: { token: SolanaAddress }; amount: number }'
    expect(
      compare(brand + transaction, brand + transaction).incompatible,
    ).toEqual([])
    expect(
      compare(
        brand + transaction,
        brand + transaction.replace('amount: number', 'amount: string'),
      ).incompatible,
    ).not.toEqual([])
  })
  it('allows declared migration but keeps consumed RC-to-stable changesets strict', () => {
    const scratch = resolve(import.meta.dirname, '../../.scratch')
    mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(join(scratch, 'contract-generation-'))
    const git = (...args: string[]) =>
      runCommand('git', args, { cwd: root, quiet: true })
    const changeset = join(root, '.changeset/migration.md')
    try {
      git('init', '--quiet')
      writeJson(join(root, 'src/package.json'), { version: '2.17.1' })
      git('add', '.')
      const v2Base = git('write-tree')
      mkdirSync(join(root, '.changeset'), { recursive: true })
      writeFileSync(
        changeset,
        '---\n"@rhinestone/sdk": major\n---\nV3 migration.\n',
      )
      writeJson(join(root, 'src/package.json'), { version: '3.0.0-rc.0' })
      expect(declaredSdkBump(v2Base, root)).toBe('major')
      expect(declaresSurfaceChange(v2Base, root)).toBe(true)
      git('add', '.')
      const candidateBase = git('write-tree')
      rmSync(changeset)
      writeJson(join(root, 'src/package.json'), { version: '3.0.0' })
      expect(declaredSdkBump(candidateBase, root)).toBeNull()
      expect(declaresSurfaceChange(candidateBase, root)).toBe(false)
      expect(assignabilityFixture('v3', 'v3')).toBe('assignability.ts')
      const unchanged = compare(
        'export type Transaction = { source: { chain: number } }',
        'export type Transaction = { source: { chain: number } }',
      )
      expect(unchanged.incompatible).toEqual([])
      expect(unchanged.removed).toEqual([])
      writeFileSync(changeset, '---\n"@rhinestone/sdk": patch\n---\nPatch.\n')
      // Use a new name: existing pending changesets never authorize this PR.
      const patch = join(root, '.changeset/patch.md')
      writeFileSync(patch, '---\n"@rhinestone/sdk": patch\n---\nPatch.\n')
      expect(declaredSdkBump(candidateBase, root)).toBe('patch')
      expect(declaresSurfaceChange(candidateBase, root)).toBe(false)
      const incompatible = compare(
        'export type Transaction = { source: { chain: number } }',
        'export type Transaction = { source: { chain: string } }',
      )
      expect(incompatible.incompatible).not.toEqual([])
      const removed = compare(
        'export type Transaction = { source: { chain: number } }',
        'export type Replacement = { source: { chain: number } }',
      )
      expect(removed.removed).not.toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
