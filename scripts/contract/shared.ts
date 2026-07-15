import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
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

export interface ContractProvenance {
  formatVersion: 1
  sourceSha: string
  sourceDirty: boolean
  packageName: string
  packageVersion: string
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
