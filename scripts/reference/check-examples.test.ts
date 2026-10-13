import { describe, expect, it } from 'vitest'
import {
  assertExampleFunding,
  assertPublicFixture,
  extractExamples,
  type FixtureLocation,
  formatDiagnostic,
  pageImports,
  partitionDiagnostics,
  type SerializedDiagnostic,
  validateRegistry,
} from './check-examples'

const page = `## Import

\`\`\`ts
import { enable } from '@rhinestone/sdk/actions/ecdsa'
\`\`\`

## Usage

### First overload
\`\`\`ts
const calls = enable(owners)
\`\`\`
#### Parameters

### Second overload
\`\`\`typescript
const result = enable(otherOwners)
\`\`\`

## See also
`

describe('exhaustive public-package Usage gate', () => {
  it('extracts all overload blocks without changing the text and records MDX lines', () => {
    const result = extractExamples(page)
    expect(result.usage.map((block) => block.text)).toEqual([
      'const calls = enable(owners)\n',
      'const result = enable(otherOwners)\n',
    ])
    expect(result.usage[0].line).toBe(11)
    expect(result.imports).toHaveLength(1)
  })

  it.each([
    ['missing Usage', '## Parameters\n'],
    ['empty block', '## Usage\n```ts\n\n```\n'],
    ['unsupported language', '## Usage\n```js\nenable()\n```\n'],
    ['unclosed fence', '## Usage\n```ts\nenable()\n'],
    ['unsupported fence style', '## Usage\n~~~ts\nenable()\n~~~\n'],
    ['malformed fence', '## Usage\n````ts\nenable()\n````\n'],
    ['duplicate Usage', `${page}\n## Usage\n\`\`\`ts\nenable()\n\`\`\`\n`],
  ])('rejects %s', (_, text) => {
    expect(() => extractExamples(text)).toThrow()
  })

  it('fails closed for missing/stale pages and added/deleted blocks', () => {
    const pages = new Map([['test', extractExamples(page)]])
    const fixture = { setup: '' }
    expect(() => validateRegistry(pages, {})).toThrow('Missing')
    expect(() => validateRegistry(pages, { test: [fixture] })).toThrow(
      'rendered 2',
    )
    expect(() =>
      validateRegistry(pages, { test: [fixture, fixture, fixture] }),
    ).toThrow('rendered 2')
    expect(() =>
      validateRegistry(pages, { test: [fixture, fixture], stale: [] }),
    ).toThrow('Stale')
    expect(() =>
      validateRegistry(pages, { test: [fixture, fixture] }),
    ).not.toThrow()
  })

  it('rejects runtime-invalid funding even when the input compiles', () => {
    const execution =
      'account.prepareTransaction({ destination: { chain, calls }, sponsored: true })'
    expect(() => assertExampleFunding(execution)).not.toThrow()
    expect(() =>
      assertExampleFunding(execution.replace(', sponsored: true', '')),
    ).toThrow('requires sponsorship')
    expect(() =>
      assertExampleFunding('account.prepareTransaction({ chain, calls })'),
    ).toThrow('Obsolete')
    expect(() =>
      assertExampleFunding(
        'account.prepareTransaction({ destination: { chain, token, amount } })',
      ),
    ).toThrow('explicit source')
    expect(() =>
      assertExampleFunding(
        'account.prepareTransaction({ source: { chain, token }, destination: { chain, token, amount } })',
      ),
    ).not.toThrow()
    expect(() =>
      assertExampleFunding(
        'account.prepareTransaction({ destination: { chain, authority } })',
      ),
    ).not.toThrow()
    expect(() =>
      assertExampleFunding(
        'account.prepareTransaction({ destination: { chain, authority }, sponsored: true })',
      ),
    ).toThrow('intrinsic sponsorship')
  })

  it('handles authored imports without rewriting Usage or silently hiding a broken import', () => {
    const imports = extractExamples(page).imports
    expect(pageImports(imports, 'const calls = enable(owners)\n')).toBe(
      imports[0].text,
    )
    expect(
      pageImports(
        imports,
        "import { enable } from '@rhinestone/sdk/actions/ecdsa'\n",
      ),
    ).toBe('')
    expect(
      pageImports(
        imports,
        "import { enable as another } from '@rhinestone/sdk/actions/ecdsa'\n",
      ),
    ).toBe(imports[0].text)
    expect(() =>
      pageImports(
        imports,
        "import { enable } from '@rhinestone/sdk/actions/passkeys'\n",
      ),
    ).toThrow('Conflicting')
  })

  it.each([
    'declare const input: any',
    'const input = value as unknown',
    'const input = <unknown>value',
    '// @ts-expect-error\ninvalid()',
    "import { input } from '../../src/index'",
    "declare const input: import('../../src/index').Transaction",
  ])('rejects permissive or source-only positive fixture: %s', (text) => {
    expect(() => assertPublicFixture(text)).toThrow()
  })

  describe('single compiler pass', () => {
    const negatives = new Map([
      ['/c/negative-auth.ts', 2345],
      ['/c/negative-import.ts', 2305],
    ])
    const diagnostic = (
      file: string | undefined,
      code: number,
    ): SerializedDiagnostic => ({ file, line: 1, code, message: 'm' })

    it('counts fixture, global, and declaration diagnostics as positive', () => {
      const fixture = diagnostic('/c/page--1.ts', 2322)
      const global = diagnostic(undefined, 2318)
      const declaration = diagnostic(
        '/c/node_modules/@rhinestone/sdk/dist/index.d.ts',
        2304,
      )
      const { positive } = partitionDiagnostics(
        [
          fixture,
          global,
          declaration,
          diagnostic('/c/negative-auth.ts', 2345),
          diagnostic('/c/negative-import.ts', 2305),
        ],
        negatives,
      )
      expect(positive).toEqual([fixture, global, declaration])
    })

    it('excludes probe diagnostics and requires each expected code', () => {
      expect(
        partitionDiagnostics(
          [
            diagnostic('/c/negative-auth.ts', 2345),
            diagnostic('/c/negative-auth.ts', 2554),
            diagnostic('/c/negative-import.ts', 2305),
          ],
          negatives,
        ),
      ).toEqual({ positive: [], missingNegatives: [] })
      expect(
        partitionDiagnostics(
          [diagnostic('/c/negative-auth.ts', 2322)],
          negatives,
        ).missingNegatives,
      ).toEqual(['/c/negative-auth.ts', '/c/negative-import.ts'])
      // A matching code in another file does not satisfy the probe.
      expect(
        partitionDiagnostics(
          [
            diagnostic('/c/page--1.ts', 2345),
            diagnostic('/c/negative-import.ts', 2305),
          ],
          negatives,
        ).missingNegatives,
      ).toEqual(['/c/negative-auth.ts'])
    })

    it('maps diagnostics to rendered MDX lines', () => {
      const locations = new Map<string, FixtureLocation>([
        [
          '/c/page--2.ts',
          { page: 'actions/enable', block: 2, start: 4, line: 20, length: 3 },
        ],
      ])
      const at = (line: number, file = '/c/page--2.ts') =>
        formatDiagnostic({ file, line, code: 2322, message: 'bad' }, locations)
      expect(at(4)).toBe('actions/enable.mdx block 2 line 20: TS2322 bad')
      expect(at(6)).toBe('actions/enable.mdx block 2 line 22: TS2322 bad')
      expect(at(7)).toBe(
        'actions/enable.mdx block 2 context/assertion line 7: TS2322 bad',
      )
      expect(at(2)).toBe(
        'actions/enable.mdx block 2 context/assertion line 2: TS2322 bad',
      )
      expect(at(1, '/c/other.d.ts')).toBe('/c/other.d.ts: TS2322 bad')
      expect(
        formatDiagnostic({ line: 0, code: 2318, message: 'x' }, locations),
      ).toBe('compiler: TS2318 x')
    })
  })
})
