// Generates Mintlify MDX reference pages for the public SDK surface.
//
// Pipeline: `typedoc --json` emits a structured model of the public API; this
// script walks the curated manifest, looks up each symbol in that model, and
// renders one MDX page per symbol against a fixed viem-style template
// (Import / Usage / Parameters / Returns), then patches the nested
// Wallets → Custom signer → SDK reference group in the docs repo's docs.json.
//
// Run: bun run scripts/reference/generate.ts
// Output dir: $SDK_REF_OUT (default: ../../../docs/wallets/custom-signer/sdk-reference)

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
import { type NavGroup, patchReferenceNavigation } from './navigation'
import { createRenderer } from './render'

const HERE = dirname(fileURLToPath(import.meta.url))
const TYPEDOC_JSON =
  process.env.SDK_REF_TYPEDOC_JSON ?? join(HERE, 'typedoc.json.out')
const DOCS_ROOT = resolve(HERE, '../../../docs')
const NAV_BASE = 'wallets/custom-signer/sdk-reference'
const OUT_DIR = process.env.SDK_REF_OUT ?? join(DOCS_ROOT, NAV_BASE)

// When set, the render exits non-zero on any coverage problem (an unresolved
// manifest symbol or a public export missing from the manifest) instead of
// just warning. Used by CI to block reference drift at PR time.
const CHECK = process.env.SDK_REF_CHECK === '1'

// Manifest symbols that could not be resolved in the TypeDoc model, collected
// during render so CHECK mode can fail on them.
const unresolved: string[] = []

// ---------------------------------------------------------------------------
// TypeDoc JSON traversal
// ---------------------------------------------------------------------------

type TDNode = any

const project = JSON.parse(readFileSync(TYPEDOC_JSON, 'utf8'))

function moduleName(source: string): string {
  return source === '.' ? 'index' : source.replace(/^\.\//, '')
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

// The class-level comment lives on the class node, not its constructor.
function classComment(entry: SymbolEntry): TDNode | undefined {
  if (entry.callStyle !== 'constructor') return undefined
  const mod = findModule(entry.source)
  const cls = (mod?.children ?? []).find((c: TDNode) => c.name === entry.symbol)
  return cls?.comment
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

function pagePath(entry: SymbolEntry, trail: string[]): string {
  return [...trail, slug(entry.title ?? entry.symbol)].join('/')
}

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

const nameToPage = buildNameToPage()
const renderer = createRenderer({ nameToPage, classComment })

function renderPage(entry: SymbolEntry): string | null {
  const node = resolveNode(entry)
  if (!node) {
    console.error(`! could not resolve ${entry.source}#${entry.symbol}`)
    unresolved.push(`${entry.source}#${entry.symbol}`)
    return null
  }
  return renderer.renderPage(entry, node)
}

// ---------------------------------------------------------------------------
// Walk manifest: assign page paths, render, collect nav
// ---------------------------------------------------------------------------

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

// Filesystem destinations remain configurable for isolated local and CI runs;
// public routes and the navigation hierarchy are fixed.
const DOCS_JSON = process.env.SDK_REF_DOCS_JSON ?? join(DOCS_ROOT, 'docs.json')

function patchDocsJson(pages: (string | NavGroup)[]) {
  if (!existsSync(DOCS_JSON)) {
    console.error(`! docs.json not found at ${DOCS_JSON}; skipping nav patch`)
    return
  }
  const docs = JSON.parse(readFileSync(DOCS_JSON, 'utf8'))
  patchReferenceNavigation(docs, pages)
  writeFileSync(DOCS_JSON, `${JSON.stringify(docs, null, 2)}\n`)
  console.info(
    'Patched "SDK reference" group into "Custom signer" in "Wallets"',
  )
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
  'experimental_getModuleSetup', // advanced/internal
  'walletClientToAccount', // adapter, deferred
  'wrapParaAccount', // adapter, deferred
])

// Warn about function/class/method exports that live in modules the manifest
// already documents, but are themselves missing from it. Scoped this way so
// out-of-scope modules (jwt-server, errors, types, the standalone
// /smart-sessions module) are never flagged.
function warnMissingCoverage(): string[] {
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
  return missing
}

function main() {
  cleanGenerated()

  const navPages = build(manifest as Node[], [NAV_BASE])
  patchDocsJson(navPages)
  const missing = warnMissingCoverage()

  console.info(`Generated ${countPages(navPages)} pages under ${OUT_DIR}`)

  if (CHECK && (unresolved.length || missing.length)) {
    console.error(
      `\n! reference coverage check failed: ${unresolved.length} unresolved symbol(s), ${missing.length} undocumented export(s).`,
    )
    process.exit(1)
  }
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
