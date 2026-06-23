// Generates Mintlify MDX reference pages for the public SDK surface.
//
// Pipeline: `typedoc --json` emits a structured model of the public API; this
// script walks the curated manifest, looks up each symbol in that model, and
// renders one MDX page per symbol against a fixed viem-style template
// (Import / Usage / Parameters / Returns), then patches the "SDK Reference"
// tab into the docs repo's docs.json.
//
// Run: bun run scripts/reference/generate.ts
// Output dir: $SDK_REF_OUT (default: ../../../docs/sdk-reference)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifest, type Node, type SymbolEntry } from './manifest'

const HERE = dirname(fileURLToPath(import.meta.url))
const TYPEDOC_JSON = join(HERE, 'typedoc.json.out')
const OUT_DIR =
  process.env.SDK_REF_OUT ?? resolve(HERE, '../../../docs/sdk-reference')
const NAV_BASE = 'sdk-reference'

// ---------------------------------------------------------------------------
// TypeDoc JSON traversal
// ---------------------------------------------------------------------------

type TDNode = any

const project = JSON.parse(readFileSync(TYPEDOC_JSON, 'utf8'))

function moduleName(source: string): string {
  return source === '.' ? 'index' : source.replace(/^\.\//, '')
}

function importSubpath(source: string): string {
  return source === '.' ? '' : source.replace(/^\./, '')
}

function findModule(source: string): TDNode | undefined {
  const name = moduleName(source)
  return (project.children ?? []).find((c: TDNode) => c.name === name)
}

function resolveNode(entry: SymbolEntry): TDNode | undefined {
  const mod = findModule(entry.source)
  if (!mod) return undefined
  if (entry.container) {
    const parent = (mod.children ?? []).find(
      (c: TDNode) => c.name === entry.container,
    )
    if (!parent) return undefined
    if (entry.callStyle === 'constructor') {
      return (parent.children ?? []).find((c: TDNode) => c.kind === 512)
    }
    return (parent.children ?? []).find((c: TDNode) => c.name === entry.symbol)
  }
  if (entry.callStyle === 'constructor') {
    // Class symbol: render its constructor.
    const cls = (mod.children ?? []).find(
      (c: TDNode) => c.name === entry.symbol,
    )
    return cls
  }
  return (mod.children ?? []).find((c: TDNode) => c.name === entry.symbol)
}

// All call signatures for a symbol (an overloaded method has more than one).
function signaturesOf(node: TDNode, entry: SymbolEntry): TDNode[] {
  if (!node) return []
  if (entry.callStyle === 'constructor') {
    const ctor =
      node.kind === 512
        ? node
        : (node.children ?? []).find((c: TDNode) => c.kind === 512)
    return ctor?.signatures ?? []
  }
  return node.signatures ?? []
}

// Merge parameters across overloads: union the types per parameter name, keep
// the first description, and treat a param as required unless optional everywhere.
function mergeParameters(sigs: TDNode[]): TDNode[] {
  const byName = new Map<string, TDNode>()
  for (const sig of sigs) {
    for (const p of sig.parameters ?? []) {
      const existing = byName.get(p.name)
      if (!existing) {
        byName.set(p.name, {
          name: p.name,
          types: [typeToString(p.type)],
          optional: !!p.flags?.isOptional,
          comment: p.comment,
        })
      } else {
        const t = typeToString(p.type)
        if (!existing.types.includes(t)) existing.types.push(t)
        existing.optional = existing.optional && !!p.flags?.isOptional
        existing.comment = existing.comment ?? p.comment
      }
    }
  }
  return [...byName.values()]
}

// The class-level comment lives on the class node, not its constructor.
function classComment(entry: SymbolEntry): TDNode | undefined {
  if (entry.callStyle !== 'constructor') return undefined
  const mod = findModule(entry.source)
  const cls = (mod?.children ?? []).find((c: TDNode) => c.name === entry.symbol)
  return cls?.comment
}

// ---------------------------------------------------------------------------
// Type rendering (types are out of scope as pages — render as plain names)
// ---------------------------------------------------------------------------

function typeToString(t: TDNode | undefined): string {
  if (!t) return 'unknown'
  switch (t.type) {
    case 'intrinsic':
      return t.name
    case 'literal':
      return typeof t.value === 'string' ? `'${t.value}'` : String(t.value)
    case 'reference': {
      // Drop type arguments when they expand to something huge (e.g. viem's
      // TypedDataDefinition) — the bare name is far more readable.
      const inner = (t.typeArguments ?? []).map(typeToString).join(', ')
      const args = inner && inner.length <= 40 ? `<${inner}>` : ''
      return `${t.name}${args}`
    }
    case 'array':
      return `${typeToString(t.elementType)}[]`
    case 'union':
      return t.types.map(typeToString).join(' | ')
    case 'intersection':
      return t.types.map(typeToString).join(' & ')
    case 'tuple':
      return `[${(t.elements ?? []).map(typeToString).join(', ')}]`
    case 'reflection': {
      const d = t.declaration
      if (d?.signatures?.length) {
        const sig = d.signatures[0]
        const params = (sig.parameters ?? [])
          .map((p: TDNode) => `${p.name}: ${typeToString(p.type)}`)
          .join(', ')
        return `(${params}) => ${typeToString(sig.type)}`
      }
      if (d?.children?.length) {
        const fields = d.children
          .map((c: TDNode) => `${c.name}: ${typeToString(c.type)}`)
          .join('; ')
        return fields.length <= 80 ? `{ ${fields} }` : 'object'
      }
      return '{}'
    }
    case 'indexedAccess':
      return `${typeToString(t.objectType)}[${typeToString(t.indexType)}]`
    case 'typeOperator':
      return `${t.operator} ${typeToString(t.target)}`
    case 'query':
      return `typeof ${typeToString(t.queryType)}`
    case 'templateLiteral': {
      const tail = (t.tail ?? [])
        .map(
          ([type, lit]: [TDNode, string]) => `\${${typeToString(type)}}${lit}`,
        )
        .join('')
      return `\`${t.head}${tail}\``
    }
    case 'named-tuple-member':
      return `${t.name}: ${typeToString(t.element)}`
    case 'optional':
      return `${typeToString(t.elementType)}?`
    case 'rest':
      return `...${typeToString(t.elementType)}`
    case 'conditional':
    case 'mapped':
      return t.name ?? 'object'
    default:
      return t.name ?? 'unknown'
  }
}

function unwrapPromise(t: TDNode | undefined): TDNode | undefined {
  if (t?.type === 'reference' && t.name === 'Promise') {
    return t.typeArguments?.[0] ?? t
  }
  return t
}

// Names for the single return value, where the verb-stripped default is wrong.
const RETURN_NAME_OVERRIDES: Record<string, string> = {
  signMessage: 'signature',
  signTypedData: 'signature',
  signEip7702InitData: 'signature',
  experimental_signEnableSession: 'signature',
  signIntent: 'signatures',
  waitForExecution: 'result',
  deploy: 'success',
  setup: 'success',
  toViewOnlyAccount: 'account',
}

const RETURN_VERBS =
  /^(get|set|is|has|sign|prepare|submit|send|create|wait|split|deploy|setup|check|to|enable|disable|add|remove|change|recover|install|uninstall)/

// A meaningful name for the returned value (e.g. getAddress -> "address"),
// used for both the ResponseField name and the usage snippet's variable.
function returnFieldName(entry: SymbolEntry): string {
  if (entry.callStyle === 'action') return 'call'
  if (RETURN_NAME_OVERRIDES[entry.symbol]) {
    return RETURN_NAME_OVERRIDES[entry.symbol]
  }
  const base = entry.symbol.replace(/^experimental_/, '')
  const m = base.match(RETURN_VERBS)
  if (m) {
    const rest = base.slice(m[0].length)
    if (rest) return rest.charAt(0).toLowerCase() + rest.slice(1)
  }
  return 'result'
}

// Split a rendered summary into a one-line description (first paragraph) and an
// optional extended explainer (the remaining paragraphs).
function splitSummary(summary: string): { short: string; rest: string } {
  const paras = summary.split(/\n\s*\n/)
  return {
    short: oneLine(paras[0] ?? ''),
    rest: paras.slice(1).join('\n\n').trim(),
  }
}

// Returns the properties of an object-literal type, or undefined if the type is
// not a plain object literal (named types and unions are left as a single row).
function objectFields(t: TDNode | undefined): TDNode[] | undefined {
  if (
    t?.type === 'reflection' &&
    t.declaration?.children?.length &&
    !t.declaration.signatures?.length
  ) {
    return t.declaration.children
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Comment / doc-comment rendering
// ---------------------------------------------------------------------------

// Map of bare symbol name -> page path, for {@link} and @see resolution.
// Names that collide across subpaths are dropped (rendered as inline code).
const nameToPage = buildNameToPage()

function buildNameToPage(): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const walk = (nodes: Node[], trail: string[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        walk(node.items, [...trail, slug(node.group)])
      } else {
        const page = pagePath(node, trail)
        const name = node.symbol
        map.set(name, map.has(name) ? null : page)
      }
    }
  }
  walk(manifest, [NAV_BASE])
  return map
}

function renderParts(parts: TDNode[] | undefined): string {
  if (!parts) return ''
  return parts
    .map((p) => {
      if (p.kind === 'inline-tag' && p.tag === '@link') {
        const label = p.text?.trim() ?? ''
        const target = label.replace(/\(\)$/, '')
        const page = nameToPage.get(target)
        return page ? `[${label}](/${page})` : `\`${label}\``
      }
      return p.text ?? ''
    })
    .join('')
    .trim()
}

function blockTag(comment: TDNode | undefined, tag: string): TDNode[] {
  return (comment?.blockTags ?? []).filter((t: TDNode) => t.tag === tag)
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

function slug(name: string): string {
  return name
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function pagePath(entry: SymbolEntry, trail: string[]): string {
  return [...trail, slug(entry.title ?? entry.symbol)].join('/')
}

function importLine(entry: SymbolEntry): string {
  const name = entry.callStyle === 'constructor' ? entry.symbol : entry.symbol
  return `import { ${name} } from '@rhinestone/sdk${importSubpath(entry.source)}'`
}

function usageSnippet(entry: SymbolEntry, sig: TDNode | undefined): string {
  const paramNames = (sig?.parameters ?? [])
    .filter((p: TDNode) => !p.flags?.isOptional)
    .map((p: TDNode) => p.name)
  const params = paramNames.join(', ')
  const isPromise =
    sig?.type?.type === 'reference' && sig.type.name === 'Promise'
  const awaitKw = isPromise ? 'await ' : ''
  const ret = isPromise ? sig.type.typeArguments?.[0] : sig?.type
  // Avoid shadowing a parameter with the return variable (TDZ / invalid example).
  let varName = returnFieldName(entry)
  if (paramNames.includes(varName)) {
    varName =
      ['result', 'output', 'value', 'res'].find(
        (c) => !paramNames.includes(c),
      ) ?? `${varName}_`
  }
  const assign =
    ret && !(ret.type === 'intrinsic' && ret.name === 'void')
      ? `const ${varName} = `
      : ''
  switch (entry.callStyle) {
    case 'accountMethod':
      return `${assign}${awaitKw}account.${entry.symbol}(${params})`
    case 'sdkMethod':
      return `${assign}${awaitKw}sdk.${entry.symbol}(${params})`
    case 'constructor':
      return `const sdk = new ${entry.symbol}({\n  // ...config\n})`
    case 'action':
      // Actions return calls; the realistic usage is passing them to
      // prepareTransaction (or sendUserOperation) on an account instance.
      return [
        `const transaction = await account.prepareTransaction({`,
        `  chain,`,
        `  calls: [${entry.symbol}(${params})],`,
        `})`,
      ].join('\n')
    default:
      return `${assign}${awaitKw}${entry.symbol}(${params})`
  }
}

function instanceNote(entry: SymbolEntry): string | undefined {
  if (entry.callStyle === 'accountMethod') {
    const page = nameToPage.get('createAccount')
    const link = page ? `[\`createAccount\`](/${page})` : '`createAccount`'
    return `Method on an account instance returned by ${link}.`
  }
  if (entry.callStyle === 'sdkMethod') {
    const page = nameToPage.get('RhinestoneSDK')
    const link = page ? `[\`RhinestoneSDK\`](/${page})` : '`RhinestoneSDK`'
    return `Method on a ${link} instance.`
  }
  return undefined
}

function renderPage(entry: SymbolEntry): string | null {
  const node = resolveNode(entry)
  if (!node) {
    console.error(`! could not resolve ${entry.source}#${entry.symbol}`)
    return null
  }
  const sigs = signaturesOf(node, entry)
  // Prefer the signature carrying the JSDoc for prose/usage; overloads merge below.
  const sig = sigs.find((s: TDNode) => s.comment) ?? sigs[0]
  const isCtor = entry.callStyle === 'constructor'
  const sigComment = sig?.comment
  // For a constructor page, the page-level prose lives on the class comment;
  // params/returns come from the constructor signature.
  const docComment = isCtor
    ? (classComment(entry) ?? sigComment)
    : (sigComment ?? node.comment)
  const comment = docComment
  const title = entry.title ?? entry.symbol
  const { short, rest } = splitSummary(renderParts(comment?.summary))

  const out: string[] = []
  out.push('---')
  out.push(`title: ${yaml(title)}`)
  if (short) out.push(`description: ${yaml(stripMd(short))}`)
  out.push('---')
  out.push('')

  if (entry.experimental) {
    out.push(
      '<Warning>This API is experimental and may change in a future release.</Warning>',
    )
    out.push('')
  }

  // The one-line summary is rendered by Mintlify from the frontmatter
  // `description`; only the extended explainer (if any) goes in the body.
  if (rest) {
    out.push(rest)
    out.push('')
  }

  for (const r of blockTag(comment, '@remarks')) {
    out.push(`<Note>${oneLine(renderParts(r.content))}</Note>`)
    out.push('')
  }

  const note = instanceNote(entry)
  if (note) {
    out.push(note)
    out.push('')
  }

  // Import (only for directly-importable symbols).
  if (
    entry.callStyle === 'function' ||
    entry.callStyle === 'action' ||
    entry.callStyle === 'constructor'
  ) {
    out.push('## Import')
    out.push('')
    out.push('```ts')
    out.push(importLine(entry))
    out.push('```')
    out.push('')
  }

  // Usage: prefer authored @example blocks, else a synthesized snippet.
  const examples = [
    ...blockTag(docComment, '@example'),
    ...(sigComment && sigComment !== docComment
      ? blockTag(sigComment, '@example')
      : []),
  ]
  out.push('## Usage')
  out.push('')
  if (examples.length) {
    for (const ex of examples) {
      out.push(renderParts(ex.content))
      out.push('')
    }
  } else {
    out.push('```ts')
    out.push(usageSnippet(entry, sig))
    out.push('```')
    out.push('')
  }

  // Parameters (merged across overloads).
  const params = mergeParameters(sigs)
  if (params.length) {
    out.push('## Parameters')
    out.push('')
    for (const p of params) {
      const required = p.optional ? '' : ' required'
      const desc = renderParts(p.comment?.summary)
      out.push(
        `<ParamField path="${p.name}" type="${escapeAttr(p.types.join(' | '))}"${required}>`,
      )
      if (desc) out.push(`  ${desc}`)
      out.push('</ParamField>')
      out.push('')
    }
  }

  // Returns (omitted for constructors). Union return types across overloads.
  const retTypes = sigs.map((s: TDNode) => s.type).filter(Boolean)
  const retType = retTypes[0]
  const isVoid = retType?.type === 'intrinsic' && retType.name === 'void'
  if (retType && !isVoid && !isCtor) {
    out.push('## Returns')
    out.push('')
    const retDesc = renderParts(blockTag(sigComment, '@returns')[0]?.content)
    // Unwrap Promise<T> so an object-literal return expands into per-field rows.
    const unwrapped = unwrapPromise(retType)
    const unionType = [
      ...new Set(retTypes.map((t: TDNode) => typeToString(unwrapPromise(t)))),
    ].join(' | ')
    const fields = retTypes.length === 1 ? objectFields(unwrapped) : undefined
    if (fields) {
      if (retDesc) {
        out.push(retDesc)
        out.push('')
      }
      for (const f of fields) {
        const optional = f.flags?.isOptional ? '' : ' required'
        out.push(
          `<ResponseField name="${f.name}" type="${escapeAttr(typeToString(f.type))}"${optional}>`,
        )
        out.push('</ResponseField>')
        out.push('')
      }
    } else {
      out.push(
        `<ResponseField name="${returnFieldName(entry)}" type="${escapeAttr(unionType)}">`,
      )
      if (retDesc) out.push(`  ${retDesc}`)
      out.push('</ResponseField>')
      out.push('')
    }
  }

  // See also. TypeDoc merges consecutive @see tags into one blockTag whose
  // content already carries `-` bullets, so normalize rather than re-bullet.
  const sees = blockTag(sigComment ?? docComment, '@see')
  if (sees.length) {
    out.push('## See also')
    out.push('')
    for (const s of sees) {
      for (const line of renderParts(s.content).split('\n')) {
        const t = line.trim().replace(/^-\s*/, '')
        if (t) out.push(`- ${t}`)
      }
    }
    out.push('')
  }

  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim()
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'")
}

// Quote a value for YAML frontmatter (descriptions may contain `:` etc.).
function yaml(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Strip markdown links/code from a string destined for frontmatter prose.
function stripMd(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '')
}

// ---------------------------------------------------------------------------
// Walk manifest: assign page paths, render, collect nav
// ---------------------------------------------------------------------------

type NavGroup = { group: string; pages: (string | NavGroup)[] }

function build(nodes: Node[], trail: string[]): (string | NavGroup)[] {
  const pages: (string | NavGroup)[] = []
  for (const node of nodes) {
    if (node.kind === 'group') {
      const nav: NavGroup = {
        group: node.group,
        pages: build(node.items, [...trail, slug(node.group)]),
      }
      // Drop groups whose symbols all failed to resolve (e.g. after a symbol is
      // removed from the SDK but not yet from the manifest).
      if (nav.pages.length) pages.push(nav)
    } else {
      const page = pagePath(node, trail)
      const mdx = renderPage(node)
      if (!mdx) continue
      // `page` is doc-root-relative (starts with NAV_BASE); strip that prefix so
      // files land inside OUT_DIR — the same dir cleanGenerated wipes.
      const rel = page.startsWith(`${NAV_BASE}/`)
        ? page.slice(NAV_BASE.length + 1)
        : page
      const file = join(OUT_DIR, `${rel}.mdx`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, mdx)
      pages.push(page)
    }
  }
  return pages
}

// The reference is nested as a single collapsible group at the bottom of the
// host tab's pages, rather than its own top-level tab.
const SECTION_NAME = 'SDK Reference'
const HOST_TAB = process.env.SDK_REF_TAB ?? 'Wallet'
const DOCS_JSON =
  process.env.SDK_REF_DOCS_JSON ?? resolve(HERE, '../../../docs/docs.json')

function patchDocsJson(pages: (string | NavGroup)[]) {
  if (!existsSync(DOCS_JSON)) {
    console.error(`! docs.json not found at ${DOCS_JSON}; skipping nav patch`)
    return
  }
  const docs = JSON.parse(readFileSync(DOCS_JSON, 'utf8'))
  const tabs = docs.navigation?.tabs
  if (!Array.isArray(tabs)) {
    console.error('! docs.json has no navigation.tabs; skipping nav patch')
    return
  }
  // Drop any standalone "SDK Reference" tab from earlier runs.
  const stale = tabs.findIndex((t: any) => t.tab === SECTION_NAME)
  if (stale >= 0) tabs.splice(stale, 1)

  const host = tabs.find((t: any) => t.tab === HOST_TAB)
  if (!host || !Array.isArray(host.pages)) {
    console.error(
      `! "${HOST_TAB}" tab (with a pages array) not found; skipping nav patch`,
    )
    return
  }
  const section: NavGroup = { group: SECTION_NAME, pages }
  const existing = host.pages.findIndex(
    (p: any) => typeof p === 'object' && p.group === SECTION_NAME,
  )
  if (existing >= 0) {
    host.pages[existing] = section
  } else {
    host.pages.push(section)
  }
  writeFileSync(DOCS_JSON, `${JSON.stringify(docs, null, 2)}\n`)
  console.info(`Patched "${SECTION_NAME}" group into "${HOST_TAB}" tab`)
}

// Hand-written pages that live alongside the generated ones and must survive
// regeneration (the manual-content channel). Empty for now.
const MANUAL_PAGES: string[] = []

function cleanGenerated() {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true })
    return
  }
  // Remove every generated subtree but keep hand-written top-level pages.
  for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (entry.isFile() && MANUAL_PAGES.includes(entry.name)) continue
    rmSync(join(OUT_DIR, entry.name), { recursive: true, force: true })
  }
}

// Public value exports we have intentionally left undocumented. The coverage
// check below treats these as expected, so it only warns about genuinely new
// or forgotten exports. Listed here (rather than silently skipped) so the
// deliberate exclusions stay visible.
const UNDOCUMENTED_OK = new Set<string>([
  'createRhinestoneAccount', // superseded by RhinestoneSDK in the reference
  'experimental_getModuleSetup', // advanced/internal
  'walletClientToAccount', // adapter, deferred
  'wrapParaAccount', // adapter, deferred
])

// Warn about function/class/method exports that live in modules the manifest
// already documents, but are themselves missing from it. Scoped this way so
// out-of-scope modules (jwt-server, errors, types, the standalone
// /smart-sessions module) are never flagged.
function warnMissingCoverage() {
  const documented = new Set(nameToPage.keys())
  const containers = new Set<string>()
  const modules = new Set<string>()
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === 'group') walk(n.items)
      else {
        modules.add(moduleName(n.source))
        if (n.container) containers.add(n.container)
      }
    }
  }
  walk(manifest)

  const missing: string[] = []
  const consider = (mod: string, name: string) => {
    if (!documented.has(name) && !UNDOCUMENTED_OK.has(name)) {
      missing.push(`${mod}: ${name}`)
    }
  }
  for (const modName of modules) {
    const mod = findModule(modName === 'index' ? '.' : `./${modName}`)
    for (const child of mod?.children ?? []) {
      if (containers.has(child.name)) {
        for (const m of child.children ?? []) {
          if (m.kind === 2048) consider(modName, m.name) // methods
        }
      }
      if (child.kind === 64 || child.kind === 128) {
        consider(modName, child.name) // functions, classes
      }
    }
  }

  if (missing.length) {
    console.error(
      `! ${missing.length} public export(s) in documented modules are missing from the manifest:`,
    )
    for (const m of missing) console.error(`    ${m}`)
    console.error(
      '  Add them to manifest.ts, or to UNDOCUMENTED_OK in generate.ts if intentional.',
    )
  }
}

function main() {
  cleanGenerated()

  const navPages = build(manifest as Node[], [NAV_BASE])
  patchDocsJson(navPages)
  warnMissingCoverage()

  console.info(`Generated ${countPages(navPages)} pages under ${OUT_DIR}`)
}

function countPages(pages: (string | NavGroup)[]): number {
  let n = 0
  for (const p of pages) {
    if (typeof p === 'string') n++
    else n += countPages(p.pages)
  }
  return n
}

main()
