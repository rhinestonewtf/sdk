import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import sizeLimits from '../../.size-limit.ts'
import type { PackageManifest } from '../../scripts/contract/shared.ts'

interface ReleaseCalibration {
  packageName: string
  entrypoints: PackageManifest['exports']
  runtimeExports: Record<string, string[]>
}

interface JwtProbeResult {
  ok: boolean
  exports?: string[]
  code?: string
  name?: string
  message?: string
}

interface ErrorIdentityProbeResult {
  threw: boolean
  strictConstructorIdentity?: boolean
  instanceOfPublicConstructor?: boolean
  name?: string
  message?: string
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const calibration = readJson<ReleaseCalibration>(
  join(import.meta.dirname, 'snapshots/release-package.json'),
)

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is required; run this suite through the staged test:contract command`,
    )
  }
  return value
}

const currentPackageDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_PACKAGE_DIR',
)
const currentConsumerDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_CONSUMER_DIR',
)
const currentNoOptionalDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_NO_OPTIONAL_DIR',
)
const currentNoExpressDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_NO_EXPRESS_DIR',
)

function runProbe<T>(consumerDirectory: string, mode: string): T {
  const result = spawnSync('node', ['probe.mjs', mode], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `Runtime probe failed (${mode}):\n${result.stderr || result.stdout}`,
    )
  }
  return JSON.parse(result.stdout) as T
}

function packageFiles(directory: string): string[] {
  const files: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(directory)
  return files
}

function missingRelativeImports(packageDirectory: string): string[] {
  const missing: string[] = []
  const importPattern = /(?:from\s+|import\s*\()["'](\.[^"']+)["']/g
  for (const file of packageFiles(packageDirectory).filter((path) =>
    /\.(?:js|d\.ts)$/.test(path),
  )) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const target = resolve(file, '..', match[1])
      if (!existsSync(target)) missing.push(`${file}: ${match[1]}`)
    }
  }
  return missing
}

function privateSourceImports(packageDirectory: string): string[] {
  const violations: string[] = []
  for (const file of packageFiles(packageDirectory).filter((path) =>
    /\.(?:js|d\.ts)$/.test(path),
  )) {
    const source = readFileSync(file, 'utf8')
    if (
      /["']@rhinestone\/sdk\/(?:src|test)\//.test(source) ||
      /["'][^"']*\/(?:test|\.staging)\//.test(source)
    ) {
      violations.push(file)
    }
  }
  return violations
}

describe('packed package contract', () => {
  it('preserves the manifest entry points and package metadata contract', () => {
    const manifest = readJson<PackageManifest>(
      join(currentPackageDirectory, 'package.json'),
    )

    expect(manifest.name).toBe(calibration.packageName)
    expect(manifest.exports).toEqual(calibration.entrypoints)

    for (const target of Object.values(manifest.exports)) {
      expect(existsSync(resolve(currentPackageDirectory, target.import))).toBe(
        true,
      )
      expect(existsSync(resolve(currentPackageDirectory, target.types))).toBe(
        true,
      )
    }
  })

  it('keeps a calibrated size gate for every published entry point', () => {
    const entrypoints = Object.entries(calibration.entrypoints)
    const expectedNames = entrypoints.map(([entrypoint]) =>
      entrypoint === '.'
        ? calibration.packageName
        : `${calibration.packageName}/${entrypoint.slice(2)}`,
    )
    const expectedPaths = entrypoints.map(
      ([, target]) => `./src/${target.import.slice(2)}`,
    )

    expect(sizeLimits.map(({ name }) => name)).toEqual(expectedNames)
    expect(sizeLimits.map(({ path }) => path)).toEqual(expectedPaths)
  })

  it('preserves every ESM runtime export key', () => {
    const currentExports = runProbe<Record<string, string[]>>(
      currentConsumerDirectory,
      'exports',
    )
    expect(currentExports).toEqual(calibration.runtimeExports)
  })

  it('preserves public error constructor identity at a throwing boundary', () => {
    const currentResult = runProbe<ErrorIdentityProbeResult>(
      currentConsumerDirectory,
      'error-identity',
    )

    expect(currentResult).toEqual({
      threw: true,
      strictConstructorIdentity: true,
      instanceOfPublicConstructor: true,
      name: 'Error',
      message: 'Owners field is required for smart accounts',
    })
  })

  it('resolves the passkey signing subpath from the export map', () => {
    const currentExports = runProbe<Record<string, string[]>>(
      currentConsumerDirectory,
      'exports',
    )
    expect(currentExports['./signing/passkeys']).toEqual(
      calibration.runtimeExports['./signing/passkeys'],
    )
  })

  it('imports the root without optional server peers', () => {
    expect(runProbe<string[]>(currentNoOptionalDirectory, 'root')).toEqual(
      calibration.runtimeExports['.'],
    )
  })

  it('preserves optional-peer behavior for the JWT server entry point', () => {
    const withoutExpress = runProbe<JwtProbeResult>(
      currentNoExpressDirectory,
      'jwt-server',
    )
    expect(withoutExpress).toEqual({
      ok: true,
      exports: calibration.runtimeExports['./jwt-server'],
    })

    const withoutJose = runProbe<JwtProbeResult>(
      currentNoOptionalDirectory,
      'jwt-server',
    )
    expect(withoutJose.ok).toBe(false)
    expect(withoutJose.code).toBe('ERR_MODULE_NOT_FOUND')
    expect(withoutJose.message).toContain("Cannot find package 'jose'")
  })

  it('contains no broken relative or private source imports', () => {
    expect(missingRelativeImports(currentPackageDirectory)).toEqual([])
    expect(privateSourceImports(currentPackageDirectory)).toEqual([])
  })
})
