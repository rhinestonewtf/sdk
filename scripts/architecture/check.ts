import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { transitionalLegacyFiles } from './legacy-files'

export interface DependencyEdge {
  readonly from: string
  readonly to: string
  readonly typeOnly: boolean
}

export interface ArchitectureGraph {
  readonly files: readonly string[]
  readonly edges: readonly DependencyEdge[]
  readonly sourceText: Readonly<Record<string, string>>
}

export interface ArchitectureViolation {
  readonly rule: string
  readonly path: readonly string[]
  readonly message: string
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = resolve(repositoryRoot, 'src')

const publishedBarrels = new Set([
  'src/index.ts',
  'src/actions/index.ts',
  'src/errors/index.ts',
  'src/jwt-server/index.ts',
  'src/smart-sessions/index.ts',
  'src/utils/index.ts',
])

const workflowLayers = new Set(['intents', 'user-operations'])
const concreteClientFiles = new Set([
  'auth.ts',
  'client.ts',
  'compatibility.ts',
  'endpoints.ts',
  'fetch.ts',
  'mappers.ts',
  'providers.ts',
  'transport.ts',
  'wire.gen.ts',
])

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}

function sourcePath(path: string): string {
  return normalizePath(relative(repositoryRoot, path))
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'dist' ? [] : listSourceFiles(path)
    }
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.d.ts') ||
      entry.name === 'wire.gen.ts'
    ) {
      return []
    }
    return [path]
  })
}

function resolveInternalImport(
  from: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(resolve(repositoryRoot, from)), specifier)
  const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')]
  const target = candidates.find((candidate) => existsSync(candidate))
  if (!target || !target.startsWith(`${sourceRoot}${sep}`)) return undefined
  return sourcePath(target)
}

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name || !clause.namedBindings) return false
  if (ts.isNamespaceImport(clause.namedBindings)) return false
  return clause.namedBindings.elements.every((element) => element.isTypeOnly)
}

function collectEdges(path: string, source: ts.SourceFile): DependencyEdge[] {
  const edges: DependencyEdge[] = []

  const addEdge = (
    specifier: ts.Expression | undefined,
    typeOnly: boolean,
  ): void => {
    if (!specifier || !ts.isStringLiteral(specifier)) return
    const target = resolveInternalImport(path, specifier.text)
    if (target) edges.push({ from: path, to: target, typeOnly })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addEdge(node.moduleSpecifier, importIsTypeOnly(node))
    } else if (ts.isExportDeclaration(node)) {
      addEdge(node.moduleSpecifier, node.isTypeOnly)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addEdge(node.arguments[0], false)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return edges
}

export function readArchitectureGraph(): ArchitectureGraph {
  const absoluteFiles = listSourceFiles(sourceRoot).sort((left, right) =>
    sourcePath(left).localeCompare(sourcePath(right)),
  )
  const files = absoluteFiles.map(sourcePath)
  const sourceText: Record<string, string> = {}
  const edges: DependencyEdge[] = []

  for (const [index, file] of files.entries()) {
    const text = readFileSync(absoluteFiles[index], 'utf8')
    sourceText[file] = text
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    edges.push(...collectEdges(file, source))
  }

  return { files, edges, sourceText }
}

function layer(path: string): string {
  return path.split('/')[1] ?? ''
}

function clientFile(path: string): string | undefined {
  if (layer(path) !== 'clients') return undefined
  return path.split('/').at(-1)
}

function isConcreteClient(path: string): boolean {
  const file = clientFile(path)
  return file !== undefined && concreteClientFiles.has(file)
}

function edgeViolation(
  edge: DependencyEdge,
): ArchitectureViolation | undefined {
  const fromLayer = layer(edge.from)
  const toLayer = layer(edge.to)
  const fail = (rule: string, message: string): ArchitectureViolation => ({
    rule,
    path: [edge.from, edge.to],
    message,
  })

  if (publishedBarrels.has(edge.to)) {
    return fail(
      'no-public-barrels',
      'internal rewrite code imports a published barrel',
    )
  }

  if (
    fromLayer === 'actions' &&
    toLayer === 'api' &&
    !(
      edge.from === 'src/actions/deploy.ts' &&
      edge.to === 'src/api/account.ts' &&
      edge.typeOnly
    )
  ) {
    return fail(
      'actions-api',
      'actions may only type-import api/account.ts from deploy.ts',
    )
  }

  if (
    isConcreteClient(edge.to) &&
    edge.from !== 'src/api/compose.ts' &&
    layer(edge.from) !== 'clients' &&
    !(
      edge.to === 'src/clients/rpc/compatibility.ts' &&
      (edge.from === 'src/actions/runtime.ts' ||
        edge.from === 'src/smart-sessions/index.ts')
    )
  ) {
    return fail(
      'concrete-client-boundary',
      'only composition and named compatibility shims may import concrete clients',
    )
  }

  if (
    toLayer === 'clients' &&
    fromLayer !== 'clients' &&
    fromLayer !== 'api' &&
    !['port.ts', 'types.ts', 'errors.ts'].includes(clientFile(edge.to) ?? '') &&
    !(
      edge.to === 'src/clients/rpc/compatibility.ts' &&
      (edge.from === 'src/actions/runtime.ts' ||
        edge.from === 'src/smart-sessions/index.ts')
    )
  ) {
    return fail(
      'narrow-client-port',
      'domain and workflow code may import only stable client ports, types, and errors',
    )
  }

  const forbiddenByLayer: Readonly<Record<string, ReadonlySet<string>>> = {
    chains: new Set([
      'accounts',
      'actions',
      'api',
      'calls',
      'clients',
      'config',
      'intents',
      'modules',
      'signing',
      'user-operations',
    ]),
    calls: new Set([
      'accounts',
      'actions',
      'api',
      'clients',
      'config',
      'intents',
      'modules',
      'signing',
      'user-operations',
    ]),
    config: new Set([
      'actions',
      'api',
      'clients',
      'intents',
      'signing',
      'user-operations',
    ]),
    modules: new Set([
      'accounts',
      'api',
      'config',
      'intents',
      'signing',
      'user-operations',
    ]),
    accounts: new Set([
      'api',
      'clients',
      'config',
      'intents',
      'signing',
      'user-operations',
    ]),
    signing: new Set(['api', 'config', 'intents', 'user-operations']),
    intents: new Set(['api', 'config', 'user-operations']),
    'user-operations': new Set(['api', 'config', 'intents']),
    actions: new Set(['intents', 'signing', 'user-operations']),
    clients: new Set(['api', 'intents', 'user-operations']),
  }

  if (forbiddenByLayer[fromLayer]?.has(toLayer)) {
    return fail('layer-direction', `${fromLayer} must not depend on ${toLayer}`)
  }

  if (
    edge.from.startsWith('src/api/queries/') &&
    (isConcreteClient(edge.to) || toLayer === 'api')
  ) {
    return fail(
      'query-boundary',
      'api queries use narrow ports and domain values only',
    )
  }

  if (
    workflowLayers.has(fromLayer) &&
    workflowLayers.has(toLayer) &&
    fromLayer !== toLayer
  ) {
    return fail(
      'workflow-isolation',
      'intent and UserOperation workflows must remain independent',
    )
  }

  return undefined
}

function shortestCycle(
  files: ReadonlySet<string>,
  edges: readonly DependencyEdge[],
): string[] | undefined {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!files.has(edge.from) || !files.has(edge.to)) continue
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
  }

  let shortest: string[] | undefined
  for (const start of files) {
    const queue: string[][] = [[start]]
    const bestDepth = new Map([[start, 0]])
    while (queue.length > 0) {
      const path = queue.shift()
      if (!path) break
      const current = path.at(-1)
      if (!current) continue
      for (const next of adjacency.get(current) ?? []) {
        if (next === start && path.length > 1) {
          const cycle = [...path, start]
          if (!shortest || cycle.length < shortest.length) shortest = cycle
          continue
        }
        const depth = path.length
        if (depth >= (bestDepth.get(next) ?? Number.POSITIVE_INFINITY)) continue
        bestDepth.set(next, depth)
        queue.push([...path, next])
      }
    }
  }
  return shortest
}

export function analyzeArchitecture(
  graph: ArchitectureGraph,
): ArchitectureViolation[] {
  const rewriteFiles = new Set(
    graph.files.filter((file) => !transitionalLegacyFiles.has(file)),
  )
  const violations: ArchitectureViolation[] = []

  for (const edge of graph.edges) {
    if (!rewriteFiles.has(edge.from)) continue
    const violation = edgeViolation(edge)
    if (violation) violations.push(violation)
  }

  for (const file of rewriteFiles) {
    if (
      ['src/common.ts', 'src/types.ts', 'src/utils.ts'].includes(file) ||
      /^src\/[^/]+\.(?:common|types|utils)\.ts$/.test(file)
    ) {
      violations.push({
        rule: 'no-global-buckets',
        path: [file],
        message: 'behaviorful global common/types/utils buckets are forbidden',
      })
    }
    if (
      /\bRhinestoneConfig\b/.test(graph.sourceText[file] ?? '') &&
      ![
        'src/actions/runtime.ts',
        'src/api/account.ts',
        'src/calls/resolve.ts',
      ].includes(file)
    ) {
      violations.push({
        rule: 'no-aggregate-config',
        path: [file],
        message:
          'rewrite internals must use narrow resolved context instead of RhinestoneConfig',
      })
    }
  }

  const cycle = shortestCycle(rewriteFiles, graph.edges)
  if (cycle) {
    violations.push({
      rule: 'no-cycles',
      path: cycle,
      message: 'rewrite import graph contains a cycle',
    })
  }

  return violations
}

function main(): void {
  const graph = readArchitectureGraph()
  const violations = analyzeArchitecture(graph)
  const files = new Set(graph.files)
  for (const file of transitionalLegacyFiles) {
    if (!files.has(file)) {
      violations.push({
        rule: 'stale-legacy-exception',
        path: [file],
        message:
          'remove the exception after replacing or deleting its legacy file',
      })
    }
  }
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `[${violation.rule}] ${violation.message}\n  ${violation.path.join(' -> ')}\n`,
      )
    }
    process.exitCode = 1
    return
  }

  const rewriteCount = graph.files.filter(
    (file) => !transitionalLegacyFiles.has(file),
  ).length
  process.stdout.write(
    `Architecture check passed for ${rewriteCount} rewrite files (${transitionalLegacyFiles.size} explicit legacy exceptions).\n`,
  )
}

if (import.meta.main) main()
