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
  checkerSensitiveDeclarations: string[]
  isNamespace: boolean
}

export interface ApiReport {
  formatVersion: 6
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
      const text = printWithNormalizedTypeParameters(
        declaration,
        declarationTypeParameters,
        checker,
        printer,
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
  const parameters: ts.TypeParameterDeclaration[] = []
  let current: ts.Node | undefined = node
  while (current) {
    if ('typeParameters' in current && current.typeParameters) {
      parameters.push(
        ...(current.typeParameters as ts.NodeArray<ts.TypeParameterDeclaration>),
      )
    }
    current = current.parent
  }
  return parameters
}

function printWithNormalizedTypeParameters(
  node: ts.Node,
  typeParameters: readonly ts.TypeParameterDeclaration[],
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
): string {
  const namesBySymbol = new Map<ts.Symbol, string>()
  for (const [index, parameter] of typeParameters.entries()) {
    const symbol = checker.getSymbolAtLocation(parameter.name)
    if (symbol) namesBySymbol.set(symbol, `T${index}`)
  }
  const result = ts.transform(node, [
    (context) => (root) => {
      const visit = (candidate: ts.Node): ts.VisitResult<ts.Node> => {
        if (ts.isIdentifier(candidate)) {
          const symbol = checker.getSymbolAtLocation(candidate)
          const name = symbol ? namesBySymbol.get(symbol) : undefined
          if (name) return ts.factory.createIdentifier(name)
        }
        return ts.visitEachChild(candidate, visit, context)
      }
      return ts.visitNode(root, visit)
    },
  ])
  const transformed = result.transformed[0]
  if (!transformed) throw new Error('Type parameter normalization failed')
  const text = printer.printNode(
    ts.EmitHint.Unspecified,
    transformed,
    node.getSourceFile(),
  )
  result.dispose()
  return normalizeText(text, packageDirectory)
}

function normalizeTypeParameterExpression(
  node: ts.TypeNode,
  typeParameters: readonly ts.TypeParameterDeclaration[],
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
): string {
  return printWithNormalizedTypeParameters(
    node,
    typeParameters,
    checker,
    printer,
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

function checkerSensitiveDeclarationsForSymbol(
  candidate: ts.Symbol,
  checker: ts.TypeChecker,
  printer: ts.Printer,
  packageDirectory: string,
  seen = new Set<ts.Symbol>(),
  declarations = new Set<string>(),
): string[] {
  const symbol =
    candidate.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(candidate)
      : candidate
  if (seen.has(symbol)) return [...declarations].sort()
  seen.add(symbol)

  const symbolDeclarations = symbol.getDeclarations() ?? []
  if (
    symbolDeclarations.length === 0 ||
    symbolDeclarations.some(
      (declaration) =>
        !resolve(declaration.getSourceFile().fileName).startsWith(
          `${resolve(packageDirectory)}/`,
        ),
    )
  ) {
    return [...declarations].sort()
  }

  const visitNode = (node: ts.Node): void => {
    if (
      node.kind === ts.SyntaxKind.AnyKeyword ||
      ts.isMethodSignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isConstructSignatureDeclaration(node) ||
      ts.isConstructorTypeNode(node) ||
      (ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === 'Readonly') ||
      (ts.isMappedTypeNode(node) && node.readonlyToken !== undefined) ||
      ((ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isIndexSignatureDeclaration(node)) &&
        ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Readonly)
    ) {
      const typeParameters = typeParametersInScope(node)
      declarations.add(
        printWithNormalizedTypeParameters(
          node,
          typeParameters,
          checker,
          printer,
          packageDirectory,
        ),
      )
      const ignoredSymbols = new Set<ts.Symbol>([symbol])
      for (const parameter of typeParameters) {
        const parameterSymbol = checker.getSymbolAtLocation(parameter.name)
        if (parameterSymbol) ignoredSymbols.add(parameterSymbol)
      }
      for (const referenced of referencedDeclarationsForNode(
        node,
        checker,
        printer,
        packageDirectory,
        ignoredSymbols,
      )) {
        declarations.add(referenced)
      }
    }
    if (ts.isIdentifier(node)) {
      const referencedSymbol = checker.getSymbolAtLocation(node)
      if (referencedSymbol) {
        checkerSensitiveDeclarationsForSymbol(
          referencedSymbol,
          checker,
          printer,
          packageDirectory,
          seen,
          declarations,
        )
      }
    }
    ts.forEachChild(node, visitNode)
  }

  for (const declaration of symbolDeclarations) visitNode(declaration)
  return [...declarations].sort()
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
              checker,
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
              checker,
              printer,
              packageDirectory,
            ),
          }
        : {}),
    })),
    hasPrivateOrProtectedMembers,
    checkerSensitiveDeclarations: checkerSensitiveDeclarationsForSymbol(
      symbol,
      checker,
      printer,
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

  return { formatVersion: 6, entrypoints }
}

if (import.meta.main) {
  const packageDirectory = process.argv[2]
  const outputPath = process.argv[3]
  if (!packageDirectory || !outputPath) {
    throw new Error('Usage: api-report.ts <package-directory> <output-path>')
  }
  writeJson(outputPath, generateApiReport(resolve(packageDirectory)))
}
