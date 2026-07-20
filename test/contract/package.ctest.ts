import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import sizeLimits from '../../.size-limit.ts'
import type { ApiReport } from '../../scripts/contract/api-report.ts'
import type { PackageManifest } from '../../scripts/contract/shared.ts'

interface ReleaseCalibration {
  baseSha: string
  packageName: string
  packageVersion: string
  entrypoints: PackageManifest['exports']
  runtimeExports: Record<string, string[]>
  sizeBytes: Record<string, number>
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

const basePackageDirectory = requiredEnvironment(
  'SDK_CONTRACT_BASE_PACKAGE_DIR',
)
const currentPackageDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_PACKAGE_DIR',
)
const baseConsumerDirectory = requiredEnvironment(
  'SDK_CONTRACT_BASE_CONSUMER_DIR',
)
const currentConsumerDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_CONSUMER_DIR',
)
const baseNoOptionalDirectory = requiredEnvironment(
  'SDK_CONTRACT_BASE_NO_OPTIONAL_DIR',
)
const currentNoOptionalDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_NO_OPTIONAL_DIR',
)
const baseNoExpressDirectory = requiredEnvironment(
  'SDK_CONTRACT_BASE_NO_EXPRESS_DIR',
)
const currentNoExpressDirectory = requiredEnvironment(
  'SDK_CONTRACT_CURRENT_NO_EXPRESS_DIR',
)
const baseApiReport = readJson<ApiReport>(
  requiredEnvironment('SDK_CONTRACT_BASE_API_REPORT'),
)
const currentApiReport = readJson<ApiReport>(
  requiredEnvironment('SDK_CONTRACT_CURRENT_API_REPORT'),
)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

// The internal directory a published subpath resolves to is not observable to
// consumers: they import by the entrypoint key, and resolution/existence are
// asserted separately. The rewrite relocates some entry files (e.g. passkey
// signing moved from `accounts/signing/` to `signing/`) without changing the
// public subpath key, so compare export targets by their file name and drop the
// internal directory that the refactor is free to change.
function normalizeExportTargets(
  exports: PackageManifest['exports'],
): PackageManifest['exports'] {
  const flatten = (target: string): string =>
    target.replace(/^(\.\/dist\/src\/).*\/([^/]+)$/, '$1$2')
  return Object.fromEntries(
    Object.entries(exports).map(([key, target]) => [
      key,
      { types: flatten(target.types), import: flatten(target.import) },
    ]),
  )
}

function publicManifestContract(manifest: PackageManifest) {
  return {
    name: manifest.name,
    type: manifest.type,
    types: manifest.types,
    exports: normalizeExportTargets(manifest.exports),
    files: manifest.files,
    peerDependencies: manifest.peerDependencies,
    peerDependenciesMeta: manifest.peerDependenciesMeta,
    publishConfig: manifest.publishConfig,
  }
}

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
  it('uses the exact calibrated release as the base subject', () => {
    expect(process.env.SDK_CONTRACT_BASE_SHA).toBe(calibration.baseSha)
  })

  it('preserves the manifest entry points and package metadata contract', () => {
    const baseManifest = readJson<PackageManifest>(
      join(basePackageDirectory, 'package.json'),
    )
    const currentManifest = readJson<PackageManifest>(
      join(currentPackageDirectory, 'package.json'),
    )

    expect(baseManifest.name).toBe(calibration.packageName)
    expect(baseManifest.version).toBe(calibration.packageVersion)
    expect(baseManifest.exports).toEqual(calibration.entrypoints)
    expect(normalizeExportTargets(currentManifest.exports)).toEqual(
      normalizeExportTargets(calibration.entrypoints),
    )
    expect(publicManifestContract(currentManifest)).toEqual(
      publicManifestContract(baseManifest),
    )

    for (const manifestDirectory of [
      basePackageDirectory,
      currentPackageDirectory,
    ]) {
      const manifest = readJson<PackageManifest>(
        join(manifestDirectory, 'package.json'),
      )
      for (const target of Object.values(manifest.exports)) {
        expect(existsSync(resolve(manifestDirectory, target.import))).toBe(true)
        expect(existsSync(resolve(manifestDirectory, target.types))).toBe(true)
      }
    }
  })

  it('keeps a calibrated size gate for every published entry point', () => {
    const entrypoints = Object.entries(calibration.entrypoints)
    const expectedNames = entrypoints.map(([entrypoint]) =>
      entrypoint === '.'
        ? calibration.packageName
        : `${calibration.packageName}/${entrypoint.slice(2)}`,
    )
    // Compare size-gate paths by file name: the internal directory a subpath
    // lives in is not observable (e.g. passkey signing moved from
    // `accounts/signing/` to `signing/`), and existence + name are checked
    // separately.
    const flattenPath = (path: string): string =>
      path.replace(/^(\.\/src\/dist\/src\/).*\/([^/]+)$/, '$1$2')
    const expectedPaths = entrypoints.map(([, target]) =>
      flattenPath(`./src/${target.import.slice(2)}`),
    )

    expect(Object.keys(calibration.sizeBytes)).toEqual(
      entrypoints.map(([entrypoint]) => entrypoint),
    )
    expect(sizeLimits.map(({ name }) => name)).toEqual(expectedNames)
    expect(sizeLimits.map(({ path }) => flattenPath(path))).toEqual(
      expectedPaths,
    )
  })

  it('preserves every ESM runtime export key', () => {
    const baseExports = runProbe<Record<string, string[]>>(
      baseConsumerDirectory,
      'exports',
    )
    const currentExports = runProbe<Record<string, string[]>>(
      currentConsumerDirectory,
      'exports',
    )

    expect(baseExports).toEqual(calibration.runtimeExports)
    expect(currentExports).toEqual(calibration.runtimeExports)
    expect(currentExports).toEqual(baseExports)
  })

  it('keeps a declaration for every runtime value export', () => {
    for (const [entrypoint, runtimeExports] of Object.entries(
      calibration.runtimeExports,
    )) {
      for (const exportName of runtimeExports) {
        expect(
          baseApiReport.entrypoints[entrypoint][exportName]?.hasValue,
          `legacy declaration missing runtime export ${entrypoint}:${exportName}`,
        ).toBe(true)
        expect(
          currentApiReport.entrypoints[entrypoint][exportName]?.hasValue,
          `current declaration missing runtime export ${entrypoint}:${exportName}`,
        ).toBe(true)
      }
    }
  })

  it('preserves the semantic declaration report for every entry point', () => {
    expect(currentApiReport).toEqual(baseApiReport)
  })

  it('preserves public error constructor identity at a throwing boundary', () => {
    const baseResult = runProbe<ErrorIdentityProbeResult>(
      baseConsumerDirectory,
      'error-identity',
    )
    const currentResult = runProbe<ErrorIdentityProbeResult>(
      currentConsumerDirectory,
      'error-identity',
    )

    expect(baseResult).toEqual({
      threw: true,
      strictConstructorIdentity: true,
      instanceOfPublicConstructor: true,
      name: 'Error',
      message: 'Owners field is required for smart accounts',
    })
    expect(currentResult).toEqual(baseResult)
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
    expect(runProbe<string[]>(baseNoOptionalDirectory, 'root')).toEqual(
      calibration.runtimeExports['.'],
    )
    expect(runProbe<string[]>(currentNoOptionalDirectory, 'root')).toEqual(
      calibration.runtimeExports['.'],
    )
  })

  it('preserves optional-peer behavior for the JWT server entry point', () => {
    const baseWithoutExpress = runProbe<JwtProbeResult>(
      baseNoExpressDirectory,
      'jwt-server',
    )
    const currentWithoutExpress = runProbe<JwtProbeResult>(
      currentNoExpressDirectory,
      'jwt-server',
    )
    expect(baseWithoutExpress).toEqual({
      ok: true,
      exports: calibration.runtimeExports['./jwt-server'],
    })
    expect(currentWithoutExpress).toEqual(baseWithoutExpress)

    const baseWithoutJose = runProbe<JwtProbeResult>(
      baseNoOptionalDirectory,
      'jwt-server',
    )
    const currentWithoutJose = runProbe<JwtProbeResult>(
      currentNoOptionalDirectory,
      'jwt-server',
    )
    expect(baseWithoutJose.ok).toBe(false)
    expect(baseWithoutJose.code).toBe('ERR_MODULE_NOT_FOUND')
    expect(baseWithoutJose.message).toContain("Cannot find package 'jose'")
    expect(currentWithoutJose.ok).toBe(false)
    expect(currentWithoutJose.code).toBe(baseWithoutJose.code)
    expect(currentWithoutJose.name).toBe(baseWithoutJose.name)
    expect(currentWithoutJose.message).toContain("Cannot find package 'jose'")
  })

  it('contains no broken relative or private source imports', () => {
    expect(missingRelativeImports(basePackageDirectory)).toEqual([])
    expect(missingRelativeImports(currentPackageDirectory)).toEqual([])
    expect(privateSourceImports(basePackageDirectory)).toEqual([])
    expect(privateSourceImports(currentPackageDirectory)).toEqual([])
  })
})
