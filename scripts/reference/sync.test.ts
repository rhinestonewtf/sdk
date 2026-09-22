import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyRegistryVersion,
  qualifyReleaseEvent,
  RELEASE_APP_ID,
  type ReleasePayload,
  stageManagedDocs,
  verifySourceFacts,
} from './sync'

const temporaryDirectories: string[] = []

function releasePayload(
  overrides: Partial<ReleasePayload> = {},
): ReleasePayload {
  return {
    action: 'published',
    repository: { full_name: 'rhinestonewtf/sdk' },
    sender: { id: RELEASE_APP_ID, login: 'rhinestone-automations[bot]' },
    release: {
      author: { id: RELEASE_APP_ID, login: 'rhinestone-automations[bot]' },
      draft: false,
      prerelease: false,
      tag_name: '@rhinestone/sdk@2.16.2',
      target_commitish: 'main',
    },
    ...overrides,
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createDocsRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-reference-sync-'))
  temporaryDirectories.push(directory)
  git(directory, 'init', '-b', 'main')
  git(directory, 'config', 'user.name', 'Test')
  git(directory, 'config', 'user.email', 'test@example.com')
  mkdirSync(join(directory, 'wallets/custom-signer/sdk-reference'), {
    recursive: true,
  })
  writeFileSync(join(directory, 'docs.json'), '{"navigation":[]}\n')
  writeFileSync(
    join(directory, 'wallets/custom-signer/sdk-reference/old.mdx'),
    'old\n',
  )
  writeFileSync(join(directory, 'unrelated.mdx'), 'keep\n')
  git(directory, 'add', '.')
  git(directory, 'commit', '-m', 'fixture')
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    execFileSync('rm', ['-rf', directory])
  }
})

describe('release qualification', () => {
  it('accepts the automated stable v2 release even when target_commitish is main', () => {
    expect(qualifyReleaseEvent(releasePayload())).toEqual({
      kind: 'qualified',
      tag: '@rhinestone/sdk@2.16.2',
      version: '2.16.2',
    })
  })

  it.each([
    ['wrong package', '@rhinestone/other@2.16.2'],
    ['v1', '@rhinestone/sdk@1.9.0'],
    ['prerelease suffix', '@rhinestone/sdk@2.16.2-dev.1'],
    ['build suffix', '@rhinestone/sdk@2.16.2+build'],
  ])('skips %s tags', (_, tag_name) => {
    expect(
      qualifyReleaseEvent(
        releasePayload({
          release: { ...releasePayload().release, tag_name },
        }),
      ),
    ).toEqual({
      kind: 'skip',
      reason: 'not a stable @rhinestone/sdk v2 tag',
    })
  })

  it.each([
    ['draft', { draft: true }],
    ['prerelease', { prerelease: true }],
  ])('skips %s releases', (_, releaseOverride) => {
    expect(
      qualifyReleaseEvent(
        releasePayload({
          release: { ...releasePayload().release, ...releaseOverride },
        }),
      ),
    ).toEqual({ kind: 'skip', reason: 'draft or prerelease event' })
  })

  it('rejects non-publication events and the wrong repository', () => {
    expect(() =>
      qualifyReleaseEvent(releasePayload({ action: 'created' })),
    ).toThrow('published release event')
    expect(() =>
      qualifyReleaseEvent(
        releasePayload({ repository: { full_name: 'rhinestonewtf/docs' } }),
      ),
    ).toThrow('unexpected repository')
  })

  it('requires both the event sender and release author to be the release app', () => {
    expect(() =>
      qualifyReleaseEvent(releasePayload({ sender: { id: 1 } })),
    ).toThrow('rhinestone-automations')
    expect(() =>
      qualifyReleaseEvent(
        releasePayload({
          release: {
            ...releasePayload().release,
            author: { id: 1 },
          },
        }),
      ),
    ).toThrow('rhinestone-automations')
  })
})

describe('published source selection', () => {
  const facts = {
    eventSha: 'abc',
    packageName: '@rhinestone/sdk',
    packageVersion: '2.16.2',
    tagCommit: 'abc',
    isReleaseAncestor: true,
  }

  it('accepts matching package, tag commit, and release ancestry', () => {
    expect(() => verifySourceFacts(facts)).not.toThrow()
  })

  it.each([
    ['package', { packageName: '@rhinestone/other' }],
    ['version', { packageVersion: '2.16.2-dev.1' }],
    ['tag', { tagCommit: 'def' }],
    ['ancestry', { isReleaseAncestor: false }],
  ])('rejects a %s mismatch', (_, override) => {
    expect(() => verifySourceFacts({ ...facts, ...override })).toThrow()
  })

  it('distinguishes current, superseded, and not-yet-propagated versions', () => {
    expect(classifyRegistryVersion('2.16.2', '2.16.2')).toEqual({
      kind: 'current',
    })
    expect(classifyRegistryVersion('2.16.2', '2.17.0')).toEqual({
      kind: 'superseded',
      latest: '2.17.0',
    })
    expect(classifyRegistryVersion('2.17.0', '2.16.2')).toEqual({
      kind: 'pending',
      latest: '2.16.2',
    })
  })
})

describe('docs staging', () => {
  it('stages additions, changes, and deletions only in managed paths', () => {
    const repository = createDocsRepository()
    writeFileSync(join(repository, 'docs.json'), '{"navigation":["new"]}\n')
    writeFileSync(
      join(repository, 'wallets/custom-signer/sdk-reference/new.mdx'),
      'new\n',
    )
    execFileSync('rm', [
      join(repository, 'wallets/custom-signer/sdk-reference/old.mdx'),
    ])

    const result = stageManagedDocs(repository)

    expect(result.changed).toBe(true)
    expect(result.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repository, 'diff', '--cached', '--name-status')).toContain(
      'docs.json',
    )
    expect(git(repository, 'diff', '--cached', '--name-status')).toContain(
      'wallets/custom-signer/sdk-reference/new.mdx',
    )
    expect(readFileSync(join(repository, 'unrelated.mdx'), 'utf8')).toBe(
      'keep\n',
    )
  })

  it('returns unchanged without creating a staged tree diff', () => {
    const repository = createDocsRepository()
    expect(stageManagedDocs(repository)).toEqual({ changed: false })
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('rejects unexpected generated or pre-staged changes', () => {
    const repository = createDocsRepository()
    writeFileSync(join(repository, 'unrelated.mdx'), 'changed\n')
    expect(() => stageManagedDocs(repository)).toThrow(
      'Unexpected docs changes',
    )

    git(repository, 'checkout', '--', 'unrelated.mdx')
    writeFileSync(join(repository, 'unrelated.mdx'), 'staged\n')
    git(repository, 'add', 'unrelated.mdx')
    expect(() => stageManagedDocs(repository)).toThrow('already staged')
  })

  it('does not require or recreate retired inventories', () => {
    const repository = createDocsRepository()
    writeFileSync(
      join(repository, 'wallets/custom-signer/sdk-reference/new.mdx'),
      'new\n',
    )
    stageManagedDocs(repository)
    expect(git(repository, 'ls-files')).not.toContain('unified-docs')
    expect(git(repository, 'ls-files')).not.toContain(
      'scripts/fixtures/sdk-reference-paths.json',
    )
  })
})
