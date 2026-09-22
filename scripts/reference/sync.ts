import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const SDK_PACKAGE = '@rhinestone/sdk'
export const RELEASE_APP_ID = 258_219_874
export const DOCS_BASE_BRANCH = 'main'
export const DOCS_UPDATE_BRANCH = 'update/sdk-reference'
export const REFERENCE_ROOT = 'wallets/custom-signer/sdk-reference'
export const MANAGED_PATHS = [REFERENCE_ROOT, 'docs.json'] as const

export type ReleasePayload = {
  action?: string
  repository?: { full_name?: string }
  sender?: { id?: number; login?: string }
  release?: {
    author?: { id?: number; login?: string }
    draft?: boolean
    prerelease?: boolean
    tag_name?: string
    html_url?: string
    target_commitish?: string
  }
}

export type ReleaseQualification =
  | { kind: 'qualified'; version: string; tag: string }
  | { kind: 'skip'; reason: string }

export type SourceFacts = {
  eventSha: string
  packageName: string
  packageVersion: string
  tagCommit: string
  isReleaseAncestor: boolean
}

export type RegistryStatus =
  | { kind: 'current' }
  | { kind: 'superseded'; latest: string }
  | { kind: 'pending'; latest: string }

const stableV2Pattern = /^2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseTagPattern =
  /^@rhinestone\/sdk@(2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/

export function qualifyReleaseEvent(
  payload: ReleasePayload,
): ReleaseQualification {
  const release = payload.release
  if (payload.action !== 'published' || !release) {
    throw new Error('Expected a published release event')
  }
  if (payload.repository?.full_name !== 'rhinestonewtf/sdk') {
    throw new Error('Release event is for an unexpected repository')
  }
  if (
    payload.sender?.id !== RELEASE_APP_ID ||
    release.author?.id !== RELEASE_APP_ID
  ) {
    throw new Error('Release was not published by rhinestone-automations')
  }
  if (release.draft || release.prerelease) {
    return { kind: 'skip', reason: 'draft or prerelease event' }
  }

  const tag = release.tag_name ?? ''
  const match = releaseTagPattern.exec(tag)
  if (!match) {
    return { kind: 'skip', reason: 'not a stable @rhinestone/sdk v2 tag' }
  }
  return { kind: 'qualified', tag, version: match[1] }
}

export function verifySourceFacts(facts: SourceFacts): void {
  if (facts.packageName !== SDK_PACKAGE) {
    throw new Error(`Unexpected package name: ${facts.packageName}`)
  }
  if (!stableV2Pattern.test(facts.packageVersion)) {
    throw new Error(`Package version is not stable v2: ${facts.packageVersion}`)
  }
  if (facts.tagCommit !== facts.eventSha) {
    throw new Error('Release tag does not resolve to the event commit')
  }
  if (!facts.isReleaseAncestor) {
    throw new Error('Release commit is not in origin/release history')
  }
}

function versionTuple(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function classifyRegistryVersion(
  candidate: string,
  latest: string,
): RegistryStatus {
  if (candidate === latest) return { kind: 'current' }
  const candidateTuple = versionTuple(candidate)
  const latestTuple = versionTuple(latest)
  if (!candidateTuple || !latestTuple) return { kind: 'pending', latest }
  for (let index = 0; index < candidateTuple.length; index += 1) {
    if (latestTuple[index] > candidateTuple[index]) {
      return { kind: 'superseded', latest }
    }
    if (latestTuple[index] < candidateTuple[index]) {
      return { kind: 'pending', latest }
    }
  }
  return { kind: 'pending', latest }
}

export function isManagedPath(path: string): boolean {
  return path === 'docs.json' || path.startsWith(`${REFERENCE_ROOT}/`)
}

export function assertManagedPaths(paths: string[]): void {
  const unexpected = paths.filter((path) => !isManagedPath(path))
  if (unexpected.length > 0) {
    throw new Error(`Unexpected docs changes: ${unexpected.join(', ')}`)
  }
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => string

const runCommand: CommandRunner = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

function gitLines(
  runner: CommandRunner,
  cwd: string,
  args: string[],
): string[] {
  const output = runner('git', args, cwd)
  return output ? output.split('\n').filter(Boolean) : []
}

export function stageManagedDocs(
  docsDirectory: string,
  runner: CommandRunner = runCommand,
): { changed: boolean; tree?: string } {
  const cwd = resolve(docsDirectory)
  const alreadyStaged = gitLines(runner, cwd, [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACDMRTUXB',
  ])
  if (alreadyStaged.length > 0) {
    throw new Error(
      `Docs checkout was already staged: ${alreadyStaged.join(', ')}`,
    )
  }

  const changedPaths = new Set([
    ...gitLines(runner, cwd, [
      'diff',
      '--name-only',
      '--diff-filter=ACDMRTUXB',
    ]),
    ...gitLines(runner, cwd, ['ls-files', '--others', '--exclude-standard']),
  ])
  assertManagedPaths([...changedPaths])

  runner('git', ['add', '-A', '--', ...MANAGED_PATHS], cwd)
  const staged = gitLines(runner, cwd, [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACDMRTUXB',
  ])
  assertManagedPaths(staged)
  if (staged.length === 0) return { changed: false }
  return { changed: true, tree: runner('git', ['write-tree'], cwd) }
}

function appendOutput(name: string, value: string): void {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  appendFileSync(output, `${name}=${value}\n`)
}

function appendSummary(message: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  appendFileSync(summary, `${message}\n`)
}

function packageManifest(): { name?: string; version?: string } {
  return JSON.parse(readFileSync(resolve('src/package.json'), 'utf8'))
}

async function checkRegistry(version: string, attempts: number): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const latest = runCommand('npm', [
        'view',
        SDK_PACKAGE,
        'dist-tags.latest',
        '--json',
      ]).replaceAll('"', '')
      const status = classifyRegistryVersion(version, latest)
      if (status.kind === 'current') {
        const published = runCommand('npm', [
          'view',
          `${SDK_PACKAGE}@${version}`,
          'version',
          '--json',
        ]).replaceAll('"', '')
        if (published !== version) {
          throw new Error(`npm did not confirm ${SDK_PACKAGE}@${version}`)
        }
        appendOutput('eligible', 'true')
        appendSummary(`SDK reference source: ${SDK_PACKAGE}@${version}`)
        return
      }
      if (status.kind === 'superseded') {
        appendOutput('eligible', 'false')
        appendSummary(
          `SDK reference skipped: ${version} was superseded by npm latest ${status.latest}.`,
        )
        return
      }
      lastError = new Error(
        `npm latest is ${status.latest}; waiting for ${version} to propagate`,
      )
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) await Bun.sleep(10_000)
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to confirm npm publication')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'qualify-event') {
    const eventPath = process.env.GITHUB_EVENT_PATH
    if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required')
    const qualified = qualifyReleaseEvent(
      JSON.parse(readFileSync(eventPath, 'utf8')),
    )
    if (qualified.kind === 'skip') {
      appendOutput('eligible', 'false')
      appendSummary(`SDK reference skipped: ${qualified.reason}.`)
      return
    }
    appendOutput('eligible', 'true')
    appendOutput('version', qualified.version)
    appendOutput('tag', qualified.tag)
    appendSummary(
      `SDK release event: ${qualified.tag} at ${process.env.GITHUB_SHA ?? 'unknown SHA'}`,
    )
    return
  }

  if (command === 'verify-source') {
    const version = process.env.SDK_VERSION
    const tag = process.env.SDK_TAG
    const eventSha = process.env.GITHUB_SHA
    if (!version || !tag || !eventSha) {
      throw new Error('SDK_VERSION, SDK_TAG, and GITHUB_SHA are required')
    }
    const manifest = packageManifest()
    const tagCommit = runCommand('git', ['rev-parse', `${tag}^{commit}`])
    let isReleaseAncestor = true
    try {
      runCommand('git', [
        'merge-base',
        '--is-ancestor',
        eventSha,
        'origin/release',
      ])
    } catch {
      isReleaseAncestor = false
    }
    verifySourceFacts({
      eventSha,
      packageName: manifest.name ?? '',
      packageVersion: manifest.version ?? '',
      tagCommit,
      isReleaseAncestor,
    })
    if (manifest.version !== version) {
      throw new Error('Release tag version does not match src/package.json')
    }
    return
  }

  if (command === 'check-registry') {
    const version = process.env.SDK_VERSION
    if (!version) throw new Error('SDK_VERSION is required')
    const attempts = Number(process.env.REGISTRY_ATTEMPTS ?? '6')
    await checkRegistry(version, attempts)
    return
  }

  if (command === 'stage-docs') {
    const docsDirectory = process.env.DOCS_DIRECTORY
    if (!docsDirectory) throw new Error('DOCS_DIRECTORY is required')
    const result = stageManagedDocs(docsDirectory)
    appendOutput('changed', String(result.changed))
    if (result.tree) {
      appendOutput('tree', result.tree)
    } else {
      appendSummary('SDK reference unchanged; no docs PR update is needed.')
    }
    return
  }

  throw new Error(`Unknown sync command: ${command ?? ''}`)
}

if (import.meta.main) {
  await main()
}
