import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import sizeLimits from '../../.size-limit.ts'
import type { ApiReport } from '../../scripts/contract/api-report.ts'
import {
  declaredSdkBump,
  type PackageManifest,
} from '../../scripts/contract/shared.ts'

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

interface CompatibilityValuesProbeResult {
  addressOnlyInitData: { address: string }
  moduleKeys: string[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is required; run this suite through the staged test:contract command`,
    )
  }
  return value
}

const baseSha = requiredEnvironment('SDK_CONTRACT_BASE_SHA')
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

// Publish metadata only, deliberately excluding `exports`: adding an entry
// point is the one manifest change a declared surface change may make, so the
// export map is compared separately and this stays strict either way.
function publishMetadataContract(manifest: PackageManifest) {
  return {
    name: manifest.name,
    type: manifest.type,
    types: manifest.types,
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

// Strictness follows the declared bump:
//
// - patch (or no new changeset, or an unreadable base): exact equality, so
//   accidental undocumented drift fails.
// - minor: additive only. New entry points, exports, and symbols are allowed,
//   but everything the base published must still be there. Shapes may widen —
//   adding a union member changes a symbol's report while staying compatible —
//   so existing symbols are checked for presence, not equality.
// - major: well-formedness only. Removals are the point of a major.
//
// `run.ts` gates the bidirectional assignability fixture on the same signal.
// Deliberate surface changes shipped under a bump that would otherwise forbid
// them. This is an override of the rule above for NAMED symbols, not an
// exemption from it: everything not listed here is still compared exactly, and
// an unlisted drift fails as before.
//
// Empty is the expected steady state. An entry earns its place by being a
// removal whose blast radius is known to be zero — not merely believed small —
// and it should be deleted at the next major, when the rule allows it outright.
const SURFACE_EXCEPTIONS: {
  reason: string
  removed: readonly string[]
  added: readonly string[]
} = {
  // RHI-5510. `hyperCoreMainnet` is replaced by `hyperCoreSpot` /
  // `hyperCorePerp`, because a HyperCore delivery must name the venue it
  // credits and the old descriptor silently defaulted to perp margin. Shipped
  // as a patch deliberately: HyperCore has never carried an external client's
  // intent (every one in prod history came from two internal projects), and a
  // consumer that does reference the old name gets a compile error naming its
  // replacement rather than a silent behaviour change.
  reason: 'RHI-5510 HyperCore delivery venues',
  removed: ['hyperCoreMainnet'],
  added: ['hyperCoreSpot', 'hyperCorePerp'],
}

const stripExceptions = (names: readonly string[], drop: readonly string[]) =>
  names.filter((name) => !drop.includes(name))

// The exception applies ONLY across the transition it describes — while the
// release baseline still publishes a listed removal.
//
// Without that condition it would outlive its purpose and start causing the
// failures it exists to prevent: once this ships, the baseline contains the
// added names too, and stripping them from `current` alone would compare a base
// that has them against a current that no longer does, failing every later clean
// patch until someone deleted the entry. Scoped this way a stale entry is inert
// rather than harmful, and it cannot hide real drift once the transition is past.
const exceptionApplies = (baseNames: readonly string[]) =>
  SURFACE_EXCEPTIONS.removed.some((name) => baseNames.includes(name))

// Base minus the deliberate removals, current minus the deliberate additions:
// what remains must still match exactly.
const reconcile = (base: readonly string[], current: readonly string[]) =>
  exceptionApplies(base)
    ? {
        base: stripExceptions(base, SURFACE_EXCEPTIONS.removed),
        current: stripExceptions(current, SURFACE_EXCEPTIONS.added),
      }
    : { base, current }

const declaredBump = declaredSdkBump(baseSha, process.cwd())
const intentionalSurfaceChange =
  declaredBump === 'minor' || declaredBump === 'major'
const additiveOnly = declaredBump === 'minor'

describe('packed package contract', () => {
  it('uses a concrete release commit as the base subject', () => {
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('publishes without runtime dependencies', () => {
    const currentManifest = readJson<PackageManifest>(
      join(currentPackageDirectory, 'package.json'),
    )

    expect(Object.keys(currentManifest.dependencies ?? {})).toEqual([])
  })

  it('preserves manifest entry points and package metadata', () => {
    const baseManifest = readJson<PackageManifest>(
      join(basePackageDirectory, 'package.json'),
    )
    const currentManifest = readJson<PackageManifest>(
      join(currentPackageDirectory, 'package.json'),
    )

    // Publish metadata must never drift, declared surface change or not.
    expect(publishMetadataContract(currentManifest)).toEqual(
      publishMetadataContract(baseManifest),
    )
    const baseTargets = normalizeExportTargets(baseManifest.exports)
    const currentTargets = normalizeExportTargets(currentManifest.exports)
    if (!intentionalSurfaceChange) {
      // The export map is the one part a declared surface change may alter.
      // Adding a subpath export is otherwise unshippable, since the base
      // manifest is packed from `release` and can never contain it.
      expect(currentTargets).toEqual(baseTargets)
    } else if (additiveOnly) {
      for (const [entrypoint, target] of Object.entries(baseTargets)) {
        expect(
          currentTargets[entrypoint],
          `minor dropped or retargeted entry point ${entrypoint}`,
        ).toEqual(target)
      }
    }

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

  it('keeps a size gate for every published entry point', () => {
    // Derived from the current manifest, not the base: a newly added entry
    // point has to carry a size gate in the same PR, and a base-derived
    // expectation would instead demand the gate be absent until release.
    const currentManifest = readJson<PackageManifest>(
      join(currentPackageDirectory, 'package.json'),
    )
    const entrypoints = Object.entries(currentManifest.exports)
    const expectedNames = entrypoints.map(([entrypoint]) =>
      entrypoint === '.'
        ? currentManifest.name
        : `${currentManifest.name}/${entrypoint.slice(2)}`,
    )
    const flattenPath = (path: string): string =>
      path.replace(/^(\.\/src\/dist\/src\/).*\/([^/]+)$/, '$1$2')
    const expectedPaths = entrypoints.map(([, target]) =>
      flattenPath(`./src/${target.import.slice(2)}`),
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

    if (intentionalSurfaceChange) {
      // Names may differ from the base; still require every entry point to
      // resolve to a non-empty export set.
      for (const [entrypoint, exports] of Object.entries(currentExports)) {
        expect(
          exports.length,
          `entry point ${entrypoint} exports nothing`,
        ).toBeGreaterThan(0)
      }
      if (additiveOnly) {
        for (const [entrypoint, names] of Object.entries(baseExports)) {
          const current = currentExports[entrypoint]
          expect(
            current,
            `minor dropped entry point ${entrypoint}`,
          ).toBeDefined()
          for (const name of names) {
            expect(
              current,
              `minor dropped runtime export ${entrypoint}:${name}`,
            ).toContain(name)
          }
        }
      }
      return
    }

    const reconciledExports = Object.fromEntries(
      Object.keys({ ...baseExports, ...currentExports }).map((entrypoint) => {
        const { base, current } = reconcile(
          baseExports[entrypoint] ?? [],
          currentExports[entrypoint] ?? [],
        )
        return [entrypoint, { base, current }]
      }),
    )
    for (const [entrypoint, { base, current }] of Object.entries(
      reconciledExports,
    )) {
      expect(current, `runtime exports drifted for ${entrypoint}`).toEqual(base)
    }
  })

  it('keeps a declaration for every runtime value export', () => {
    const currentExports = runProbe<Record<string, string[]>>(
      currentConsumerDirectory,
      'exports',
    )
    for (const [entrypoint, runtimeExports] of Object.entries(currentExports)) {
      for (const exportName of runtimeExports) {
        expect(
          currentApiReport.entrypoints[entrypoint]?.[exportName]?.hasValue,
          `current declaration missing runtime export ${entrypoint}:${exportName}`,
        ).toBe(true)
      }
    }
  })

  it('preserves the semantic declaration report for every entry point', () => {
    if (intentionalSurfaceChange) {
      // The report is expected to differ; assert it is still well-formed.
      expect(Object.keys(currentApiReport.entrypoints).length).toBeGreaterThan(
        0,
      )
      if (additiveOnly) {
        // Declaration text may widen under a minor, so shapes aren't compared —
        // that's the assignability fixture's job. What must survive is the
        // symbol and its type/value nature: swapping a type-only export for a
        // value of the same name breaks `import type { X }` consumers, and
        // gaining a nature is additive.
        for (const [entrypoint, symbols] of Object.entries(
          baseApiReport.entrypoints,
        )) {
          const current = currentApiReport.entrypoints[entrypoint]
          expect(
            current,
            `minor dropped declaration entry point ${entrypoint}`,
          ).toBeDefined()
          for (const [symbol, report] of Object.entries(symbols)) {
            const currentReport = current?.[symbol]
            expect(
              currentReport,
              `minor dropped declared export ${entrypoint}:${symbol}`,
            ).toBeDefined()
            if (report.hasType) {
              expect(
                currentReport?.hasType,
                `minor stopped exporting ${entrypoint}:${symbol} as a type`,
              ).toBe(true)
            }
            if (report.hasValue) {
              expect(
                currentReport?.hasValue,
                `minor stopped exporting ${entrypoint}:${symbol} as a value`,
              ).toBe(true)
            }
          }
        }
      }
      return
    }
    // Same reconciliation, one level deeper: the report is keyed by entry point
    // then by symbol, so drop the exception symbols from each side's symbol map.
    const dropSymbols = (
      report: typeof baseApiReport,
      drop: readonly string[],
    ) => ({
      ...report,
      entrypoints: Object.fromEntries(
        Object.entries(report.entrypoints).map(([entrypoint, symbols]) => [
          entrypoint,
          Object.fromEntries(
            Object.entries(symbols).filter(
              ([symbol]) => !drop.includes(symbol),
            ),
          ),
        ]),
      ),
    })

    // Same transition scoping as `reconcile`: only while the baseline report
    // still declares a listed removal.
    const baseSymbols = Object.values(baseApiReport.entrypoints).flatMap(
      (symbols) => Object.keys(symbols),
    )
    if (!exceptionApplies(baseSymbols)) {
      expect(currentApiReport).toEqual(baseApiReport)
      return
    }

    expect(dropSymbols(currentApiReport, SURFACE_EXCEPTIONS.added)).toEqual(
      dropSymbols(baseApiReport, SURFACE_EXCEPTIONS.removed),
    )
  })

  it('preserves compatibility-only runtime values and shapes', () => {
    const baseResult = runProbe<CompatibilityValuesProbeResult>(
      baseConsumerDirectory,
      'compatibility-values',
    )
    const currentResult = runProbe<CompatibilityValuesProbeResult>(
      currentConsumerDirectory,
      'compatibility-values',
    )

    expect(baseResult).toEqual({
      addressOnlyInitData: {
        address: '0x0000000000000000000000000000000000000001',
      },
      moduleKeys: [
        'additionalContext',
        'address',
        'deInitData',
        'initData',
        'type',
      ],
    })
    expect(currentResult).toEqual(baseResult)
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

  it('imports the root without optional server peers', () => {
    const baseResult = runProbe<string[]>(baseNoOptionalDirectory, 'root')
    const currentResult = runProbe<string[]>(currentNoOptionalDirectory, 'root')

    // Follows the same bump-aware strictness as the other surface assertions,
    // so a minor may add a root export without tripping this, and may not drop
    // one. The root must always import cleanly without the optional peers.
    expect(currentResult.length).toBeGreaterThan(0)
    if (!intentionalSurfaceChange) {
      const { base, current } = reconcile(baseResult, currentResult)
      expect(current).toEqual(base)
    } else if (additiveOnly) {
      for (const name of baseResult) {
        expect(
          currentResult,
          `minor dropped root export ${name} in the no-optional-peers install`,
        ).toContain(name)
      }
    }
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
    expect(baseWithoutExpress.ok).toBe(true)
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
