import { resolve } from 'node:path'
import ts from 'typescript'
import { type PackageManifest, readJson, writeJson } from './shared.ts'

interface ApiExportReport {
  hasType: boolean
  hasValue: boolean
  declarations: string[]
  referencedDeclarations: string[]
  valueType?: string
  callSignatures: string[]
  constructSignatures: string[]
}

export interface ApiReport {
  formatVersion: 1
  entrypoints: Record<string, Record<string, ApiExportReport>>
}

const typeFormatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteArrowStyleSignature |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature

function normalizeText(value: string, packageDirectory: string): string {
  return value
    .replaceAll('\\', '/')
    .replaceAll(packageDirectory.replaceAll('\\', '/'), '<package>')
    .replace(/import\((?:"[^"]*"|'[^']*')\)\./g, '')
    .replace(/import\((?:"[^"]*"|'[^']*')\)/g, 'import("<module>")')
    .replace(/\s+/g, ' ')
    .replace(/(?:#private;|private [A-Za-z_$][\w$]*\??;)\s*/g, '')
    .trim()
    .replace(
      /^export (?=declare |interface |type |const |class |abstract |function |enum |namespace )/,
      '',
    )
}

function declarationsForSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
): { declarations: string[]; referencedDeclarations: string[] } {
  const declarations = symbol.getDeclarations() ?? []
  const rootDeclarations = declarations.map((declaration) =>
    normalizeText(
      printer.printNode(
        ts.EmitHint.Unspecified,
        declaration,
        declaration.getSourceFile(),
      ),
      packageDirectory,
    ),
  )

  const seen = new Set<ts.Symbol>([symbol])
  const referenced = new Map<string, string>()

  const visitSymbol = (candidate: ts.Symbol): void => {
    const target =
      candidate.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(candidate)
        : candidate
    if (seen.has(target)) return
    seen.add(target)

    const targetDeclarations = target.getDeclarations() ?? []
    if (
      targetDeclarations.length === 0 ||
      targetDeclarations.some(
        (declaration) =>
          !resolve(declaration.getSourceFile().fileName).startsWith(
            `${resolve(packageDirectory)}/`,
          ),
      )
    ) {
      return
    }

    for (const declaration of targetDeclarations) {
      const text = normalizeText(
        printer.printNode(
          ts.EmitHint.Unspecified,
          declaration,
          declaration.getSourceFile(),
        ),
        packageDirectory,
      )
      referenced.set(`${target.getName()}:${text}`, text)
      ts.forEachChild(declaration, visitNode)
    }
  }

  const visitNode = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const referencedSymbol = checker.getSymbolAtLocation(node)
      if (referencedSymbol) visitSymbol(referencedSymbol)
    }
    ts.forEachChild(node, visitNode)
  }

  for (const declaration of declarations) {
    ts.forEachChild(declaration, visitNode)
  }

  return {
    declarations: rootDeclarations,
    referencedDeclarations: [...referenced.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, text]) => text),
  }
}

function reportExport(
  exportedSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
): ApiExportReport {
  const symbol =
    exportedSymbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exportedSymbol)
      : exportedSymbol
  const declarations = declarationsForSymbol(
    symbol,
    checker,
    printer,
    packageDirectory,
  )
  const declaration = symbol.valueDeclaration ?? symbol.getDeclarations()?.[0]
  const hasValue = Boolean(symbol.flags & ts.SymbolFlags.Value)
  const hasType = Boolean(symbol.flags & ts.SymbolFlags.Type)
  const valueType =
    hasValue && declaration
      ? checker.getTypeOfSymbolAtLocation(symbol, declaration)
      : undefined

  return {
    hasType,
    hasValue,
    ...declarations,
    ...(valueType
      ? {
          valueType: normalizeText(
            checker.typeToString(valueType, declaration, typeFormatFlags),
            packageDirectory,
          ),
        }
      : {}),
    callSignatures: (valueType?.getCallSignatures() ?? []).map((signature) =>
      normalizeText(
        checker.signatureToString(signature, declaration, typeFormatFlags),
        packageDirectory,
      ),
    ),
    constructSignatures: (valueType?.getConstructSignatures() ?? []).map(
      (signature) =>
        normalizeText(
          checker.signatureToString(signature, declaration, typeFormatFlags),
          packageDirectory,
        ),
    ),
  }
}

export function generateApiReport(packageDirectory: string): ApiReport {
  const manifest = readJson<PackageManifest>(
    resolve(packageDirectory, 'package.json'),
  )
  const entryFiles = Object.values(manifest.exports).map((target) =>
    resolve(packageDirectory, target.types),
  )
  const program = ts.createProgram(entryFiles, {
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

  const checker = program.getTypeChecker()
  const printer = ts.createPrinter({ removeComments: true })
  const entrypoints: ApiReport['entrypoints'] = {}

  for (const [entrypoint, target] of Object.entries(manifest.exports)) {
    const sourceFile = program.getSourceFile(
      resolve(packageDirectory, target.types),
    )
    if (!sourceFile) {
      throw new Error(`Declaration entry point not loaded: ${target.types}`)
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) {
      throw new Error(
        `Declaration entry point has no module symbol: ${target.types}`,
      )
    }

    entrypoints[entrypoint] = Object.fromEntries(
      checker
        .getExportsOfModule(moduleSymbol)
        .sort((left, right) => left.getName().localeCompare(right.getName()))
        .map((symbol) => [
          symbol.getName(),
          reportExport(symbol, checker, printer, packageDirectory),
        ]),
    )
  }

  return { formatVersion: 1, entrypoints }
}

if (import.meta.main) {
  const packageDirectory = process.argv[2]
  const outputPath = process.argv[3]
  if (!packageDirectory || !outputPath) {
    throw new Error('Usage: api-report.ts <package-directory> <output-path>')
  }
  writeJson(outputPath, generateApiReport(resolve(packageDirectory)))
}
