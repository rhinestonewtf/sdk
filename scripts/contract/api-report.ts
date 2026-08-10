import { resolve } from 'node:path'
import ts from 'typescript'
import { type PackageManifest, readJson, writeJson } from './shared.ts'

export interface ApiExportReport {
  hasType: boolean
  hasValue: boolean
  declarations: string[]
  referencedDeclarations: string[]
  valueType?: string
  callSignatures: string[]
  constructSignatures: string[]
  typeParameters: {
    isConst: boolean
    constraint?: string
    constraintReferences: string[]
    default?: string
    defaultReferences: string[]
  }[]
  hasPrivateOrProtectedMembers: boolean
  hasBivariantMethods: boolean
  isNamespace: boolean
}

export interface ApiReport {
  formatVersion: 5
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

function referencedDeclarationsForNode(
  node: ts.Node,
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
  ignoredSymbols: ReadonlySet<ts.Symbol>,
): string[] {
  const seen = new Set(ignoredSymbols)
  const referenced = new Map<string, string>()

  const visitSymbol = (candidate: ts.Symbol): void => {
    const target =
      candidate.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(candidate)
        : candidate
    if (seen.has(target)) return
    seen.add(target)

    const declarations = target.getDeclarations() ?? []
    if (
      declarations.length === 0 ||
      declarations.some(
        (declaration) =>
          !resolve(declaration.getSourceFile().fileName).startsWith(
            `${resolve(packageDirectory)}/`,
          ),
      )
    ) {
      return
    }

    for (const declaration of declarations) {
      const declarationTypeParameters = typeParametersInScope(declaration)
      const text = normalizeTypeParameterText(
        printer.printNode(
          ts.EmitHint.Unspecified,
          declaration,
          declaration.getSourceFile(),
        ),
        declarationTypeParameters,
        packageDirectory,
      )
      referenced.set(`${target.getName()}:${text}`, text)
      ts.forEachChild(declaration, visitNode)
    }
  }

  const visitNode = (candidate: ts.Node): void => {
    if (ts.isIdentifier(candidate)) {
      const symbol = checker.getSymbolAtLocation(candidate)
      if (symbol) visitSymbol(symbol)
    }
    ts.forEachChild(candidate, visitNode)
  }

  visitNode(node)
  return [...referenced.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, text]) => text)
}

function typeParametersInScope(
  node: ts.Node,
): readonly ts.TypeParameterDeclaration[] {
  let current: ts.Node | undefined = node
  while (current) {
    if ('typeParameters' in current && current.typeParameters) {
      return [
        ...(current.typeParameters as ts.NodeArray<ts.TypeParameterDeclaration>),
      ]
    }
    current = current.parent
  }
  return []
}

function normalizeTypeParameterText(
  value: string,
  typeParameters: readonly ts.TypeParameterDeclaration[],
  packageDirectory: string,
): string {
  let text = value
  for (const [index, parameter] of typeParameters.entries()) {
    const escapedName = parameter.name.text.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )
    text = text.replace(
      new RegExp(`(?<![\\w$])${escapedName}(?![\\w$])`, 'g'),
      `T${index}`,
    )
  }
  return normalizeText(text, packageDirectory)
}

function normalizeTypeParameterExpression(
  node: ts.TypeNode,
  typeParameters: readonly ts.TypeParameterDeclaration[],
  printer: ts.Printer,
  packageDirectory: string,
): string {
  return normalizeTypeParameterText(
    printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()),
    typeParameters,
    packageDirectory,
  )
}

function classHasPrivateOrProtectedMembers(
  declaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (
    declaration.members.some(
      (member) =>
        (member.name && ts.isPrivateIdentifier(member.name)) ||
        ts.getCombinedModifierFlags(member) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected),
    )
  ) {
    return true
  }

  const classType = checker.getTypeAtLocation(declaration) as ts.InterfaceType
  return (checker.getBaseTypes(classType) ?? []).some((baseType) => {
    const baseSymbol = baseType.getSymbol()
    if (!baseSymbol || seen.has(baseSymbol)) return false
    seen.add(baseSymbol)
    return (baseSymbol.getDeclarations() ?? [])
      .filter(ts.isClassDeclaration)
      .some((baseDeclaration) =>
        classHasPrivateOrProtectedMembers(baseDeclaration, checker, seen),
      )
  })
}

function symbolHasBivariantMethods(
  candidate: ts.Symbol,
  checker: ts.TypeChecker,
  packageDirectory: string,
  seen = new Set<ts.Symbol>(),
): boolean {
  const symbol =
    candidate.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(candidate)
      : candidate
  if (seen.has(symbol)) return false
  seen.add(symbol)

  const declarations = symbol.getDeclarations() ?? []
  if (
    declarations.length === 0 ||
    declarations.some(
      (declaration) =>
        !resolve(declaration.getSourceFile().fileName).startsWith(
          `${resolve(packageDirectory)}/`,
        ),
    )
  ) {
    return false
  }

  const visitNode = (node: ts.Node): boolean => {
    if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) return true
    if (ts.isIdentifier(node)) {
      const referencedSymbol = checker.getSymbolAtLocation(node)
      if (
        referencedSymbol &&
        symbolHasBivariantMethods(
          referencedSymbol,
          checker,
          packageDirectory,
          seen,
        )
      ) {
        return true
      }
    }
    return node.getChildren().some(visitNode)
  }

  return declarations.some(visitNode)
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
  const symbolDeclarations = symbol.getDeclarations() ?? []
  const genericDeclaration = symbolDeclarations.find(
    (
      candidate,
    ): candidate is ts.Declaration & {
      typeParameters: ts.NodeArray<ts.TypeParameterDeclaration>
    } => 'typeParameters' in candidate && Boolean(candidate.typeParameters),
  )
  const genericTypeParameters = [...(genericDeclaration?.typeParameters ?? [])]
  const genericTypeParameterSymbols = new Set(
    genericTypeParameters.flatMap((parameter) => {
      const parameterSymbol = checker.getSymbolAtLocation(parameter.name)
      return parameterSymbol ? [parameterSymbol] : []
    }),
  )
  const classDeclaration = symbolDeclarations.find(ts.isClassDeclaration)
  const hasPrivateOrProtectedMembers = Boolean(
    classDeclaration &&
      classHasPrivateOrProtectedMembers(classDeclaration, checker),
  )
  const isNamespace = Boolean(symbol.flags & ts.SymbolFlags.Namespace)
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
    typeParameters: genericTypeParameters.map((parameter) => ({
      isConst: Boolean(
        parameter.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword,
        ),
      ),
      constraintReferences: parameter.constraint
        ? referencedDeclarationsForNode(
            parameter.constraint,
            checker,
            printer,
            packageDirectory,
            genericTypeParameterSymbols,
          )
        : [],
      defaultReferences: parameter.default
        ? referencedDeclarationsForNode(
            parameter.default,
            checker,
            printer,
            packageDirectory,
            genericTypeParameterSymbols,
          )
        : [],
      ...(parameter.constraint
        ? {
            constraint: normalizeTypeParameterExpression(
              parameter.constraint,
              genericTypeParameters,
              printer,
              packageDirectory,
            ),
          }
        : {}),
      ...(parameter.default
        ? {
            default: normalizeTypeParameterExpression(
              parameter.default,
              genericTypeParameters,
              printer,
              packageDirectory,
            ),
          }
        : {}),
    })),
    hasPrivateOrProtectedMembers,
    hasBivariantMethods: symbolHasBivariantMethods(
      symbol,
      checker,
      packageDirectory,
    ),
    isNamespace,
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

  return { formatVersion: 5, entrypoints }
}

if (import.meta.main) {
  const packageDirectory = process.argv[2]
  const outputPath = process.argv[3]
  if (!packageDirectory || !outputPath) {
    throw new Error('Usage: api-report.ts <package-directory> <output-path>')
  }
  writeJson(outputPath, generateApiReport(resolve(packageDirectory)))
}
