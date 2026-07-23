import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface PackageExportTarget {
  types: string
  import: string
}

export interface PackageManifest {
  name: string
  version: string
  type: string
  types: string
  exports: Record<string, PackageExportTarget>
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  publishConfig?: Record<string, unknown>
}

export interface CommandOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  quiet?: boolean
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'],
  })

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(
      `Command failed (${command} ${args.join(' ')}):${output ? `\n${output}` : ''}`,
    )
  }

  if (!options.quiet && result.stdout) {
    process.stdout.write(result.stdout)
  }

  return result.stdout.trim()
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

type SemverBump = 'major' | 'minor' | 'patch'
const BUMP_RANK: Record<SemverBump, number> = { patch: 0, minor: 1, major: 2 }

// Changeset basenames present on a git ref, or null if the ref can't be read.
function changesetNamesInRef(ref: string, cwd: string): Set<string> | null {
  const result = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', ref, '--', '.changeset'],
    { cwd, encoding: 'utf8' },
  )
  if (result.status !== 0) return null
  return new Set(
    result.stdout
      .split('\n')
      .filter((path) => path.endsWith('.md') && !path.endsWith('README.md'))
      .map((path) => (path.split('/').pop() ?? '').replace(/\.md$/, '')),
  )
}

// Highest `@rhinestone/sdk` bump among changesets this PR adds (present in the
// working tree but not on `baseSha`). `.changeset/` accumulates merged-but-
// unreleased changesets — and, in changeset pre mode, released ones too until
// pre exit — so diffing against the base is the only reliable signal for what
// this PR changes. Returns null when the base tree can't be read.
function declaredSdkBump(baseSha: string, cwd: string): SemverBump | null {
  const changesetDirectory = join(cwd, '.changeset')
  if (!existsSync(changesetDirectory)) return null
  const baseChangesets = changesetNamesInRef(baseSha, cwd)
  if (baseChangesets === null) return null
  let highest: SemverBump | null = null
  for (const entry of readdirSync(changesetDirectory)) {
    if (!entry.endsWith('.md') || entry === 'README.md') continue
    if (baseChangesets.has(entry.replace(/\.md$/, ''))) continue
    const source = readFileSync(join(changesetDirectory, entry), 'utf8')
    const match = source.match(
      /['"]@rhinestone\/sdk['"]\s*:\s*(major|minor|patch)/,
    )
    if (!match) continue
    const bump = match[1] as SemverBump
    if (!highest || BUMP_RANK[bump] > BUMP_RANK[highest]) highest = bump
  }
  return highest
}

// True when this PR introduces a minor/major `@rhinestone/sdk` changeset, i.e.
// documents an intentional public-surface change. The contract suite uses this
// to relax its strict "no drift" and bidirectional-assignability checks, which
// an intentional change is allowed to break; patch-only (or no new changeset,
// or an unreadable base) keeps the strict gate so accidental breaks still fail.
export function declaresSurfaceChange(baseSha: string, cwd: string): boolean {
  const bump = declaredSdkBump(baseSha, cwd)
  return bump === 'major' || bump === 'minor'
}

function linkDependency(
  consumerNodeModules: string,
  dependencyRoot: string,
  dependency: string,
): void {
  const source = resolve(dependencyRoot, dependency)
  if (!existsSync(source)) return

  const destination = resolve(consumerNodeModules, dependency)
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(source, destination, 'junction')
}

export function createConsumerLayout(options: {
  packageDirectory: string
  consumerDirectory: string
  dependencyRoot: string
  runtimeProbePath: string
  includeOptionalPeers: boolean
}): string {
  const nodeModules = join(options.consumerDirectory, 'node_modules')
  const installedPackage = join(nodeModules, '@rhinestone', 'sdk')
  mkdirSync(dirname(installedPackage), { recursive: true })
  cpSync(options.packageDirectory, installedPackage, { recursive: true })
  cpSync(options.runtimeProbePath, join(options.consumerDirectory, 'probe.mjs'))
  writeJson(join(options.consumerDirectory, 'package.json'), {
    private: true,
    type: 'module',
  })

  const manifest = readJson<PackageManifest>(
    join(options.packageDirectory, 'package.json'),
  )
  const requiredDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => !metadata.optional)
      .map(([name]) => name),
  ])

  for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
    if (
      options.includeOptionalPeers ||
      !manifest.peerDependenciesMeta?.[dependency]?.optional
    ) {
      requiredDependencies.add(dependency)
    }
  }

  for (const dependency of requiredDependencies) {
    linkDependency(nodeModules, options.dependencyRoot, dependency)
  }

  return installedPackage
}
