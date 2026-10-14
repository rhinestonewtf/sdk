import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { syncVersion } from './sync-version'

const root = resolve(import.meta.dirname, '..')
const temporary: string[] = []
function fixture(version: unknown, source = "const SDK_VERSION = 'old'\n") {
  mkdirSync(join(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(join(root, '.scratch/version-'))
  temporary.push(directory)
  const manifest = join(directory, 'package.json')
  const client = join(directory, 'client.ts')
  writeFileSync(manifest, JSON.stringify({ version }))
  writeFileSync(client, source)
  return { directory, manifest, client }
}
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('package version synchronization', () => {
  test.each([
    '3.0.0-rc.0',
    '3.0.0',
    '0.0.0-dev-20261014120637-36e0a66651c64dd38e4f7f19cf6025fffbf98b62',
  ])('synchronizes %s idempotently', (version) => {
    const { manifest, client } = fixture(version)
    syncVersion(manifest, client)
    const expected = `const SDK_VERSION = '${version}'\n`
    expect(readFileSync(client, 'utf8')).toBe(expected)
    syncVersion(manifest, client)
    expect(readFileSync(client, 'utf8')).toBe(expected)
  })
  test.each([
    undefined,
    3,
    '3.0',
    '03.0.0',
    '3.0.0-01',
    "3.0.0'\ninjected",
    '3.0.0-',
  ])('rejects invalid version %s without writing', (version) => {
    const { manifest, client } = fixture(version)
    expect(() => syncVersion(manifest, client)).toThrow('valid semver')
    expect(readFileSync(client, 'utf8')).toBe("const SDK_VERSION = 'old'\n")
  })
  test.each([
    '',
    "const SDK_VERSION = 'old'\nconst SDK_VERSION = 'duplicate'\n",
  ])('fails closed on missing or ambiguous declarations', (source) => {
    const { manifest, client } = fixture('3.0.0', source)
    expect(() => syncVersion(manifest, client)).toThrow('exactly one')
    expect(readFileSync(client, 'utf8')).toBe(source)
  })
  test('checked-in source identity matches the manifest before any build', () => {
    const { version } = JSON.parse(
      readFileSync(join(root, 'src/package.json'), 'utf8'),
    )
    const source = readFileSync(
      join(root, 'src/clients/orchestrator/client.ts'),
      'utf8',
    )
    expect(source.match(/^const SDK_VERSION = '([^']*)'$/m)?.[1]).toBe(version)
  })
  test('installed Changesets tooling plans exactly the first stable v3 release', () => {
    const { directory } = fixture('3.0.0-rc.0')
    mkdirSync(join(directory, 'src'))
    mkdirSync(join(directory, '.changeset'))
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['./src'] }),
    )
    writeFileSync(
      join(directory, 'src/package.json'),
      JSON.stringify({ name: '@rhinestone/sdk', version: '3.0.0-rc.0' }),
    )
    writeFileSync(
      join(directory, '.changeset/config.json'),
      readFileSync(join(root, '.changeset/config.json')),
    )
    writeFileSync(
      join(directory, '.changeset/v3.md'),
      "---\n'@rhinestone/sdk': major\n---\nRelease v3.\n",
    )
    // Changesets status needs a base ref even for a synthetic release plan.
    execFileSync('git', ['init', '--initial-branch=main'], {
      cwd: directory,
      stdio: 'pipe',
    })
    execFileSync('git', ['add', '.'], { cwd: directory, stdio: 'pipe' })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'test fixture',
      ],
      { cwd: directory, stdio: 'pipe' },
    )
    const output = join(directory, 'plan.json')
    execFileSync(
      join(root, 'node_modules/.bin/changeset'),
      ['status', '--output', 'plan.json'],
      { cwd: directory, stdio: 'pipe' },
    )
    const plan = JSON.parse(readFileSync(output, 'utf8'))
    expect(plan.releases).toEqual([
      expect.objectContaining({
        name: '@rhinestone/sdk',
        oldVersion: '3.0.0-rc.0',
        newVersion: '3.0.0',
        type: 'major',
      }),
    ])
  })
})
