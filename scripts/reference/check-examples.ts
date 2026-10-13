import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createConsumerLayout, runCommand, writeJson } from '../contract/shared'
import {
  type ExampleContext,
  exampleContexts,
  inferredContracts,
  negativeExamples,
} from './example-contexts'
import { manifest, type Node } from './manifest'

export interface UsageBlock {
  text: string
  line: number
}
export interface PageExamples {
  imports: UsageBlock[]
  usage: UsageBlock[]
}

export function extractExamples(text: string): PageExamples {
  const result: PageExamples = { imports: [], usage: [] }
  let section = ''
  let fence: { language: string; line: number; lines: string[] } | undefined
  let usageSections = 0
  for (const [index, line] of text.split('\n').entries()) {
    if (fence) {
      if (/^```\s*$/.test(line)) {
        if (!fence.lines.join('\n').trim()) throw new Error('Empty code fence')
        if (section === 'Usage' || section === 'Import') {
          if (!['ts', 'typescript'].includes(fence.language))
            throw new Error(
              `Unsupported ${section} language: ${fence.language}`,
            )
          result[section === 'Usage' ? 'usage' : 'imports'].push({
            text: `${fence.lines.join('\n')}\n`,
            line: fence.line,
          })
        }
        fence = undefined
      } else fence.lines.push(line)
      continue
    }
    if (
      (section === 'Usage' || section === 'Import') &&
      /^\s*(?:`{3,}|~{3,})/.test(line) &&
      !/^```[^`]*$/.test(line)
    )
      throw new Error('Malformed or unsupported code fence')
    if (line.startsWith('```')) {
      fence = { language: line.slice(3).trim(), line: index + 2, lines: [] }
      continue
    }
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      // Single-signature pages place Parameters/Returns after Usage; overload
      // contracts use deeper headings and keep all their examples in Usage.
      section = heading[1]
      if (section === 'Usage') usageSections++
    }
  }
  if (fence) throw new Error('Unclosed code fence')
  if (usageSections !== 1 || !result.usage.length)
    throw new Error('Expected one nonempty Usage section')
  return result
}

function slug(name: string): string {
  return name
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
export function manifestPages(
  nodes: Node[] = manifest,
  trail: string[] = [],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'group'
      ? manifestPages(node.items, [...trail, slug(node.group)])
      : [[...trail, slug(node.title ?? node.symbol)].join('/')],
  )
}
export function validateRegistry(
  pages: Map<string, PageExamples>,
  registry: Record<string, ExampleContext[]>,
): void {
  for (const [page, examples] of pages) {
    if (!registry[page])
      throw new Error(`Missing context registration: ${page}`)
    if (registry[page].length !== examples.usage.length)
      throw new Error(
        `${page}: registered ${registry[page].length} blocks, rendered ${examples.usage.length}`,
      )
  }
  for (const page of Object.keys(registry))
    if (!pages.has(page)) throw new Error(`Stale context registration: ${page}`)
}

// Keep the Usage text byte-for-byte. Only omit a redundant page Import when
// that exact binding is already imported by the Usage block itself.
export function pageImports(imports: UsageBlock[], snippet: string): string {
  const source = ts.createSourceFile(
    'usage.ts',
    snippet,
    ts.ScriptTarget.Latest,
    true,
  )
  const bindings = new Map<string, string>()
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue
    const named = statement.importClause?.namedBindings
    if (named && ts.isNamedImports(named))
      for (const element of named.elements)
        bindings.set(
          element.name.text,
          `${statement.moduleSpecifier.text}:${element.propertyName?.text ?? element.name.text}`,
        )
  }
  return imports
    .map((block) => {
      const parsed = ts.createSourceFile(
        'import.ts',
        block.text,
        ts.ScriptTarget.Latest,
        true,
      )
      if (parsed.statements.length !== 1)
        throw new Error('Expected a single page import')
      const statement = parsed.statements[0]
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        throw new Error('Malformed page import')
      const named = statement.importClause?.namedBindings
      if (!named || !ts.isNamedImports(named) || named.elements.length !== 1)
        throw new Error('Expected single named page import')
      const element = named.elements[0]
      const existing = bindings.get(element.name.text)
      if (
        existing &&
        existing !==
          `${statement.moduleSpecifier.text}:${element.propertyName?.text ?? element.name.text}`
      )
        throw new Error(`Conflicting import: ${element.name.text}`)
      return existing ? '' : block.text
    })
    .join('')
}

function isPublicModule(name: string): boolean {
  return ['@rhinestone/sdk', 'viem'].some(
    (module) => name === module || name.startsWith(`${module}/`),
  )
}

export function assertPublicFixture(text: string): void {
  if (/@ts-(?:ignore|expect-error|nocheck)/.test(text))
    throw new Error('Suppression in positive fixture')
  const source = ts.createSourceFile(
    'fixture.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  )
  function visit(node: ts.Node): void {
    if (
      node.kind === ts.SyntaxKind.AnyKeyword ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node)
    )
      throw new Error('Permissive type or cast in positive fixture')
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const name = node.moduleSpecifier.text
      if (!isPublicModule(name))
        throw new Error(`Non-public fixture import: ${name}`)
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const name = node.argument.literal.text
      if (!isPublicModule(name))
        throw new Error(`Non-public fixture type import: ${name}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

// TypeScript permits source-free unsponsored execution; published literal
// examples must still satisfy the transaction's funding contract.
export function assertExampleFunding(text: string): void {
  const source = ts.createSourceFile(
    'usage.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  )
  function property(object: ts.ObjectLiteralExpression, name: string) {
    return object.properties.find(
      (entry) =>
        entry.name &&
        (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
        entry.name.text === name,
    )
  }
  function value(object: ts.ObjectLiteralExpression, name: string) {
    const entry = property(object, name)
    return entry && ts.isPropertyAssignment(entry)
      ? entry.initializer
      : undefined
  }
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'prepareTransaction'
    ) {
      const input = node.arguments[0]
      if (input && ts.isObjectLiteralExpression(input)) {
        if (property(input, 'chain') || property(input, 'calls'))
          throw new Error('Obsolete transaction envelope in Usage')
        const destination = value(input, 'destination')
        if (destination && ts.isObjectLiteralExpression(destination)) {
          if (property(destination, 'authority')) {
            if (property(input, 'sponsored'))
              throw new Error('Authority inputs have intrinsic sponsorship')
          } else if (property(destination, 'token')) {
            if (!property(input, 'source') || property(input, 'sponsored'))
              throw new Error(
                'Delivery example requires an explicit source and no sponsorship',
              )
          } else if (
            property(destination, 'calls') &&
            !property(input, 'source') &&
            value(input, 'sponsored')?.kind !== ts.SyntaxKind.TrueKeyword
          ) {
            throw new Error(
              'Source-free execution example requires sponsorship',
            )
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

function mdxFiles(directory: string, trail = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? mdxFiles(join(directory, entry.name), `${trail}${entry.name}/`)
      : entry.name.endsWith('.mdx')
        ? [`${trail}${entry.name.slice(0, -4)}`]
        : [],
  )
}
export function compile(
  files: string[],
  consumer: string,
): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: false,
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  }
  const program = ts.createProgram(files, options)
  const installed = join(consumer, 'node_modules/@rhinestone/sdk')
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (!source) throw new Error(`Missing consumer source: ${file}`)
    function checkResolution(node: ts.Node): void {
      if (
        ts.isStringLiteral(node) &&
        (node.text === '@rhinestone/sdk' ||
          node.text.startsWith('@rhinestone/sdk/'))
      ) {
        const resolved = ts.resolveModuleName(
          node.text,
          file,
          options,
          ts.sys,
        ).resolvedModule
        if (resolved && !resolved.resolvedFileName.startsWith(`${installed}/`))
          throw new Error(
            `SDK import escaped packed public package: ${node.text}`,
          )
      }
      ts.forEachChild(node, checkResolution)
    }
    checkResolution(source)
  }
  // No paths/baseUrl/source aliases: resolution starts at the staged consumer.
  if (!files.every((file) => file.startsWith(`${consumer}/`)))
    throw new Error('Consumer file outside isolated layout')
  return ts.getPreEmitDiagnostics(program)
}

export function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const scratch = join(root, '.scratch')
  mkdirSync(scratch, { recursive: true })
  const run = mkdtempSync(join(scratch, 'reference-examples-'))
  runCommand('bun', ['run', 'build'], { cwd: root })
  const model = join(run, 'typedoc.json')
  runCommand(
    'bunx',
    ['typedoc', '--options', 'scripts/reference/typedoc.json', '--json', model],
    { cwd: root },
  )
  const output = join(run, 'pages')
  runCommand('bun', ['run', 'scripts/reference/generate.ts'], {
    cwd: root,
    env: {
      SDK_REF_TYPEDOC_JSON: model,
      SDK_REF_OUT: output,
      SDK_REF_CHECK: '1',
      SDK_REF_DOCS_JSON: join(run, 'docs.json'),
      SDK_REF_OWNERSHIP_JSON: join(run, 'ownership.json'),
      SDK_REF_PATHS_FIXTURE: join(run, 'paths.json'),
    },
  })
  const expected = manifestPages().sort()
  const actual = mdxFiles(output).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error('Rendered page inventory differs from manifest')
  const pages = new Map(
    expected.map((page) => [
      page,
      extractExamples(readFileSync(join(output, `${page}.mdx`), 'utf8')),
    ]),
  )
  validateRegistry(pages, exampleContexts)
  const packed = JSON.parse(
    runCommand('npm', ['pack', '--json', '--pack-destination', run], {
      cwd: join(root, 'src'),
      quiet: true,
    }),
  )
  runCommand('tar', ['-xzf', join(run, packed[0].filename), '-C', run], {
    cwd: root,
  })
  const consumer = join(run, 'consumer')
  mkdirSync(consumer)
  const probe = join(run, 'probe.mjs')
  writeFileSync(probe, '')
  createConsumerLayout({
    packageDirectory: join(run, 'package'),
    consumerDirectory: consumer,
    dependencyRoot: join(root, 'node_modules'),
    runtimeProbePath: probe,
    includeOptionalPeers: true,
  })
  const files: string[] = []
  const locations = new Map<
    string,
    { page: string; block: number; start: number; line: number; length: number }
  >()
  for (const [page, examples] of pages) {
    for (const [index, block] of examples.usage.entries()) {
      const fixture = exampleContexts[page][index]
      const prefix = `export {}\n${pageImports(examples.imports, block.text)}${fixture.setup}`
      const file = join(
        consumer,
        `${page.replaceAll('/', '--')}--${index + 1}.ts`,
      )
      const text = `${prefix}${block.text}${fixture.assertions ?? ''}\n`
      assertPublicFixture(text)
      assertExampleFunding(block.text)
      writeFileSync(file, text)
      locations.set(file, {
        page,
        block: index + 1,
        start: prefix.split('\n').length,
        line: block.line,
        length: block.text.split('\n').length - 1,
      })
      files.push(file)
    }
  }
  const inferred = join(consumer, 'inferred-contracts.ts')
  assertPublicFixture(inferredContracts)
  writeFileSync(inferred, inferredContracts)
  files.push(inferred)
  const diagnostics = compile(files, consumer)
  const messages = diagnostics.map((diagnostic) => {
    const position = diagnostic.file?.getLineAndCharacterOfPosition(
      diagnostic.start ?? 0,
    )
    const location = diagnostic.file && locations.get(diagnostic.file.fileName)
    const line = (position?.line ?? 0) + 1
    const inSnippet =
      location &&
      line >= location.start &&
      line < location.start + location.length
    const label = location
      ? `${location.page}.mdx block ${location.block} ${inSnippet ? `line ${location.line + line - location.start}` : `context/assertion line ${line}`}`
      : (diagnostic.file?.fileName ?? 'compiler')
    return `${label}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
  })
  writeJson(join(run, 'report.json'), {
    pages: pages.size,
    blocks: files.length - 1,
    diagnostics: messages,
  })
  for (const [name, text] of Object.entries(negativeExamples)) {
    const file = join(consumer, `negative-${name}.ts`)
    writeFileSync(file, text)
    const failures = compile([file], consumer)
    const expectedCodes: Record<string, number> = {
      auth: 2345,
      legacy: 2322,
      import: 2305,
      capability: 2339,
    }
    if (
      !failures.some(
        (failure) =>
          failure.file?.fileName === file &&
          failure.code === expectedCodes[name],
      )
    )
      throw new Error(
        `Negative compiler probe did not reject the intended defect: ${name}`,
      )
  }
  console.info(
    `Reference Usage: ${pages.size} pages, ${files.length - 1} blocks; 4 negative probes. Report: ${join(run, 'report.json')}`,
  )
  if (messages.length) throw new Error(messages.join('\n'))
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
