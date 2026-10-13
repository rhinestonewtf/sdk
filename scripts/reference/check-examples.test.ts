import { describe, expect, it } from 'vitest'
import {
  assertExampleFunding,
  assertPublicFixture,
  extractExamples,
  pageImports,
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
})
