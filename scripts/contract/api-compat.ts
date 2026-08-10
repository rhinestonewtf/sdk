import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import type { ApiExportReport, ApiReport } from './api-report.ts'
import { writeJson } from './shared.ts'

export interface ApiCompatibilityFailure {
  symbol: string
  reasons: string[]
  baseDeclarations: string[]
  currentDeclarations: string[]
}

export interface ApiCompatibilityReport {
  formatVersion: 1
  added: string[]
  removed: string[]
  natureChanged: string[]
  compatible: string[]
  incompatible: ApiCompatibilityFailure[]
}

interface Comparison {
  symbol: string
  base: ApiExportReport
  current: ApiExportReport
}

interface TypeProbe {
  comparison: Comparison
  facet: string
  baseAlias: string
  currentAlias: string
}

function changedReportText(
  report: ApiExportReport,
  counterpart: ApiExportReport,
): string[] {
  if (
    JSON.stringify(report.declarations) !==
    JSON.stringify(counterpart.declarations)
  ) {
    return report.declarations
  }
  const counterpartReferences = new Set(counterpart.referencedDeclarations)
  const changedReferences = report.referencedDeclarations.filter(
    (declaration) => !counterpartReferences.has(declaration),
  )
  return changedReferences.length > 0 ? changedReferences : report.declarations
}

function sameReport(base: ApiExportReport, current: ApiExportReport): boolean {
  return JSON.stringify(base) === JSON.stringify(current)
}

function packageSpecifier(packageName: string, entrypoint: string): string {
  return entrypoint === '.'
    ? packageName
    : `${packageName}/${entrypoint.replace(/^\.\//, '')}`
}

function typeArgumentProbes(count: number): string[] {
  const probes = new Set<string>()
  for (const primary of ['never', 'any'] as const) {
    const secondary = primary === 'never' ? 'any' : 'never'
    for (let index = 0; index < count; index++) {
      const values = Array.from({ length: count }, (_, position) =>
        position === index ? primary : secondary,
      )
      probes.add(`<${values.join(', ')}>`)
    }
  }
  return [...probes]
}

function failure(
  comparison: Comparison,
  reasons: string[],
): ApiCompatibilityFailure {
  return {
    symbol: comparison.symbol,
    reasons,
    baseDeclarations: changedReportText(comparison.base, comparison.current),
    currentDeclarations: changedReportText(comparison.current, comparison.base),
  }
}

export function generateApiCompatibilityReport(options: {
  consumerDirectory: string
  baseReport: ApiReport
  currentReport: ApiReport
}): ApiCompatibilityReport {
  const added: string[] = []
  const removed: string[] = []
  const natureChanged: string[] = []
  const comparisons: Comparison[] = []
  const entrypoints = new Set([
    ...Object.keys(options.baseReport.entrypoints),
    ...Object.keys(options.currentReport.entrypoints),
  ])

  for (const entrypoint of [...entrypoints].sort()) {
    const baseSymbols = options.baseReport.entrypoints[entrypoint] ?? {}
    const currentSymbols = options.currentReport.entrypoints[entrypoint] ?? {}
    const symbols = new Set([
      ...Object.keys(baseSymbols),
      ...Object.keys(currentSymbols),
    ])
    for (const symbol of [...symbols].sort()) {
      const qualified = `${entrypoint}:${symbol}`
      const base = baseSymbols[symbol]
      const current = currentSymbols[symbol]
      if (!base) {
        added.push(qualified)
        continue
      }
      if (!current) {
        removed.push(qualified)
        continue
      }
      if (
        base.hasType !== current.hasType ||
        base.hasValue !== current.hasValue
      ) {
        natureChanged.push(qualified)
        continue
      }
      if (!sameReport(base, current)) {
        comparisons.push({ symbol: qualified, base, current })
      }
    }
  }

  const incompatible: ApiCompatibilityFailure[] = []
  const candidates: Comparison[] = []
  for (const comparison of comparisons) {
    if (comparison.base.isNamespace || comparison.current.isNamespace) {
      incompatible.push(
        failure(comparison, ['declaration text changed for a namespace']),
      )
      continue
    }
    if (
      comparison.base.hasPrivateOrProtectedMembers ||
      comparison.current.hasPrivateOrProtectedMembers
    ) {
      incompatible.push(
        failure(comparison, ['declaration text changed for a nominal class']),
      )
      continue
    }
    if (
      comparison.base.hasBivariantMethods ||
      comparison.current.hasBivariantMethods
    ) {
      incompatible.push(
        failure(comparison, [
          'declaration text changed for a type containing methods',
        ]),
      )
      continue
    }
    if (
      comparison.base.typeParameters.length !==
      comparison.current.typeParameters.length
    ) {
      incompatible.push(failure(comparison, ['type parameter arity changed']))
      continue
    }
    if (
      comparison.base.typeParameters.some((parameter, index) => {
        const currentParameter = comparison.current.typeParameters[index]
        return (
          parameter.constraint !== currentParameter?.constraint ||
          JSON.stringify(parameter.constraintReferences) !==
            JSON.stringify(currentParameter?.constraintReferences)
        )
      })
    ) {
      incompatible.push(
        failure(comparison, ['type parameter constraints changed']),
      )
      continue
    }
    if (
      comparison.base.typeParameters.some((parameter, index) => {
        const currentParameter = comparison.current.typeParameters[index]
        return (
          parameter.isConst !== currentParameter?.isConst ||
          parameter.default !== currentParameter?.default ||
          JSON.stringify(parameter.defaultReferences) !==
            JSON.stringify(currentParameter?.defaultReferences)
        )
      })
    ) {
      incompatible.push(
        failure(comparison, ['type parameter modifiers or defaults changed']),
      )
      continue
    }
    candidates.push(comparison)
  }

  const source: string[] = []
  const probes: TypeProbe[] = []
  const entrypointAliases = new Map<string, { base: string; current: string }>()
  for (const comparison of candidates) {
    const separator = comparison.symbol.indexOf(':')
    const entrypoint = comparison.symbol.slice(0, separator)
    const symbol = comparison.symbol.slice(separator + 1)
    if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) {
      incompatible.push(
        failure(comparison, ['export name is not an identifier']),
      )
      continue
    }

    let aliases = entrypointAliases.get(entrypoint)
    if (!aliases) {
      const index = entrypointAliases.size
      aliases = { base: `Base${index}`, current: `Current${index}` }
      entrypointAliases.set(entrypoint, aliases)
      source.push(
        `import * as ${aliases.base} from '${packageSpecifier('@rhinestone/sdk-base', entrypoint)}'`,
        `import * as ${aliases.current} from '${packageSpecifier('@rhinestone/sdk', entrypoint)}'`,
      )
    }

    const addProbe = (facet: string, baseType: string, currentType: string) => {
      const index = probes.length
      const baseAlias = `BaseType${index}`
      const currentAlias = `CurrentType${index}`
      source.push(
        `type ${baseAlias} = ${baseType}`,
        `type ${currentAlias} = ${currentType}`,
      )
      probes.push({
        comparison,
        facet,
        baseAlias,
        currentAlias,
      })
    }

    if (comparison.base.hasValue) {
      addProbe(
        'value',
        `typeof ${aliases.base}.${symbol}`,
        `typeof ${aliases.current}.${symbol}`,
      )
    }
    if (comparison.base.hasType) {
      const count = comparison.base.typeParameters.length
      if (count === 0) {
        addProbe(
          'type',
          `${aliases.base}.${symbol}`,
          `${aliases.current}.${symbol}`,
        )
      } else {
        for (const argumentsText of typeArgumentProbes(count)) {
          addProbe(
            `type${argumentsText}`,
            `${aliases.base}.${symbol}${argumentsText}`,
            `${aliases.current}.${symbol}${argumentsText}`,
          )
        }
        if (
          comparison.base.typeParameters.every(
            (parameter) => parameter.default !== undefined,
          )
        ) {
          addProbe(
            'type<defaults>',
            `${aliases.base}.${symbol}`,
            `${aliases.current}.${symbol}`,
          )
        }
      }
    }
  }

  const fixturePath = join(options.consumerDirectory, 'api-compat.generated.ts')
  writeFileSync(fixturePath, `${source.join('\n')}\n`)
  const program = ts.createProgram([fixturePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    )
  }

  const fixture = program.getSourceFile(resolve(fixturePath))
  if (!fixture)
    throw new Error('Generated API compatibility fixture was not loaded')
  const checker = program.getTypeChecker()
  const aliases = new Map<string, ts.TypeAliasDeclaration>()
  for (const statement of fixture.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement)
    }
  }

  const reasons = new Map<Comparison, string[]>()
  for (const probe of probes) {
    const baseAlias = aliases.get(probe.baseAlias)
    const currentAlias = aliases.get(probe.currentAlias)
    if (!baseAlias || !currentAlias) {
      throw new Error(
        `Generated aliases missing for ${probe.comparison.symbol}`,
      )
    }
    const baseType = checker.getTypeAtLocation(baseAlias.type)
    const currentType = checker.getTypeAtLocation(currentAlias.type)
    if (!checker.isTypeAssignableTo(baseType, currentType)) {
      const entries = reasons.get(probe.comparison) ?? []
      entries.push(`${probe.facet}: base is not assignable to current`)
      reasons.set(probe.comparison, entries)
    }
    if (!checker.isTypeAssignableTo(currentType, baseType)) {
      const entries = reasons.get(probe.comparison) ?? []
      entries.push(`${probe.facet}: current is not assignable to base`)
      reasons.set(probe.comparison, entries)
    }
  }

  const compatible: string[] = []
  for (const comparison of candidates) {
    const comparisonReasons = reasons.get(comparison)
    if (comparisonReasons) {
      incompatible.push(failure(comparison, comparisonReasons))
    } else if (probes.some((probe) => probe.comparison === comparison)) {
      compatible.push(comparison.symbol)
    }
  }

  return {
    formatVersion: 1,
    added,
    removed,
    natureChanged,
    compatible: compatible.sort(),
    incompatible: incompatible.sort((left, right) =>
      left.symbol.localeCompare(right.symbol),
    ),
  }
}

if (import.meta.main) {
  const consumerDirectory = process.argv[2]
  const baseReportPath = process.argv[3]
  const currentReportPath = process.argv[4]
  const outputPath = process.argv[5]
  if (
    !consumerDirectory ||
    !baseReportPath ||
    !currentReportPath ||
    !outputPath
  ) {
    throw new Error(
      'Usage: api-compat.ts <consumer-directory> <base-report> <current-report> <output-path>',
    )
  }
  const { readJson } = await import('./shared.ts')
  writeJson(
    outputPath,
    generateApiCompatibilityReport({
      consumerDirectory: resolve(consumerDirectory),
      baseReport: readJson<ApiReport>(baseReportPath),
      currentReport: readJson<ApiReport>(currentReportPath),
    }),
  )
}
