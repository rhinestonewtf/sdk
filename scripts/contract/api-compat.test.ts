import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { generateApiCompatibilityReport } from './api-compat'
import { generateApiReport } from './api-report'
import { writeJson } from './shared'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createPackage(
  root: string,
  name: string,
  declaration: string,
): string {
  const directory = join(root, name.endsWith('base') ? 'base' : 'current')
  writeJson(join(directory, 'package.json'), {
    name,
    version: '1.0.0',
    type: 'module',
    types: './index.d.ts',
    exports: {
      '.': { types: './index.d.ts', import: './index.js' },
    },
  })
  writeFileSync(join(directory, 'index.d.ts'), declaration)
  writeFileSync(join(directory, 'index.js'), '')
  return directory
}

function compare(baseDeclaration: string, currentDeclaration: string) {
  const root = mkdtempSync(join(tmpdir(), 'api-compat-test-'))
  temporaryDirectories.push(root)
  const base = createPackage(root, '@rhinestone/sdk-base', baseDeclaration)
  const current = createPackage(root, '@rhinestone/sdk', currentDeclaration)
  const external = join(root, 'node_modules/external')
  writeJson(join(external, 'package.json'), {
    name: 'external',
    version: '1.0.0',
    type: 'module',
    types: './index.d.ts',
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
  })
  writeFileSync(
    join(external, 'index.d.ts'),
    'export interface ExternalOptions { external?: string }',
  )
  writeFileSync(join(external, 'index.js'), '')
  const consumer = join(root, 'consumer')
  mkdirSync(join(consumer, 'node_modules/@rhinestone'), { recursive: true })
  cpSync(base, join(consumer, 'node_modules/@rhinestone/sdk-base'), {
    recursive: true,
  })
  cpSync(current, join(consumer, 'node_modules/@rhinestone/sdk'), {
    recursive: true,
  })
  cpSync(external, join(consumer, 'node_modules/external'), { recursive: true })
  writeJson(join(consumer, 'package.json'), { private: true, type: 'module' })

  return generateApiCompatibilityReport({
    consumerDirectory: consumer,
    baseReport: generateApiReport(base),
    currentReport: generateApiReport(current),
  })
}

describe('API compatibility report', () => {
  test('accepts a generic type parameter rename through probe instantiations', () => {
    const report = compare(
      'export type Box<K> = { value: K }',
      'export type Box<Key> = { value: Key }',
    )

    expect(report.compatible).toEqual(['.:Box'])
    expect(report.incompatible).toEqual([])
  })

  test.each([
    ['readonly property', 'readonly value: T'],
    ['method', 'set(value: T): void'],
  ])(
    'accepts a generic type parameter rename in a %s',
    (_, memberDeclaration) => {
      const report = compare(
        `export interface Box<T> { ${memberDeclaration} }`,
        `export interface Box<Value> { ${memberDeclaration.replaceAll('T', 'Value')} }`,
      )

      expect(report.compatible).toEqual(['.:Box'])
      expect(report.incompatible).toEqual([])
    },
  )

  test('accepts renamed enclosing and method type parameters', () => {
    const report = compare(
      'export interface Box<T> { map<U>(value: T): U }',
      'export interface Box<Value> { map<Item>(value: Value): Item }',
    )

    expect(report.compatible).toEqual(['.:Box'])
    expect(report.incompatible).toEqual([])
  })

  test('accepts renamed type parameters in constraints', () => {
    const report = compare(
      'export type Value<T, K extends keyof T> = T[K]',
      'export type Value<Item, Key extends keyof Item> = Item[Key]',
    )

    expect(report.compatible).toEqual(['.:Value'])
    expect(report.incompatible).toEqual([])
  })

  test('rejects changed generic constraints', () => {
    const report = compare(
      'export type Box<T extends string> = { value: T }',
      'export type Box<T extends number> = { value: T }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Box',
        reasons: ['type parameter constraints changed'],
      },
    ])
  })

  test('rejects changes to declarations referenced by generic constraints', () => {
    const report = compare(
      'type Options = { value?: string }; export type Box<T extends Options> = T',
      'type Options = { value: string }; export type Box<T extends Options> = T',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Box',
          reasons: ['type parameter constraints changed'],
        }),
      ]),
    )
  })

  test('accepts type parameter renames in constraint dependencies', () => {
    const report = compare(
      'type Options<K> = { K: K }; export type Box<T extends Options<string>> = T',
      'type Options<Key> = { K: Key }; export type Box<T extends Options<string>> = T',
    )

    expect(report.incompatible).toEqual([])
  })

  test('does not normalize matching property names as type parameters', () => {
    const report = compare(
      'type Options<K> = { K: string }; export type Box<T extends Options<string>> = T',
      'type Options<Key> = { Key: string }; export type Box<T extends Options<string>> = T',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Box',
          reasons: ['type parameter constraints changed'],
        }),
      ]),
    )
  })

  test('rejects changed generic defaults', () => {
    const report = compare(
      'export type Box<T = string> = { value: T }',
      'export type Box<T = number> = { value: T }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Box',
        reasons: ['type parameter modifiers or defaults changed'],
      },
    ])
  })

  test('rejects removed const type parameter modifiers', () => {
    const report = compare(
      'export declare function define<const T>(value: T): T',
      'export declare function define<T>(value: T): T',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:define',
        reasons: ['type parameter modifiers or defaults changed'],
      },
    ])
  })

  test('rejects incompatible relationships between generic parameters', () => {
    const report = compare(
      'export type Pair<A, B> = { first: A; second: B }',
      'export type Pair<A, B> = { first: B; second: A }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Pair',
        reasons: expect.arrayContaining([
          'type<never, any>: base is not assignable to current',
          'type<never, any>: current is not assignable to base',
        ]),
      },
    ])
  })

  test.each(['approve', 'increaseAllowance', 'transfer', 'transferFrom'])(
    'probes the %s ABI branch in public config generics',
    (functionName) => {
      const report = compare(
        `export type PermissionFunctionConfig<T extends { name: string }> = T['name'] extends '${functionName}' ? { spendingLimit?: bigint } : { spendingLimit?: never }`,
        'export type PermissionFunctionConfig<T extends { name: string }> = { spendingLimit?: never }',
      )

      expect(report.incompatible).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ symbol: '.:PermissionFunctionConfig' }),
        ]),
      )
    },
  )

  test('rejects method parameter narrowing', () => {
    const report = compare(
      'export interface Handler { on(value: string | number): void }',
      'export interface Handler { on(value: string): void }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Handler',
        reasons: ['declaration text changed for a checker-sensitive type'],
      },
    ])
  })

  test('rejects nested method parameter narrowing', () => {
    const report = compare(
      'interface Handler { on(value: string | number): void } export interface Config { handler: Handler }',
      'interface Handler { on(value: string): void } export interface Config { handler: Handler }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Config',
          reasons: ['declaration text changed for a checker-sensitive type'],
        }),
      ]),
    )
  })

  test('rejects method parameter narrowing through a referenced alias', () => {
    const report = compare(
      'type Options = string | number; export interface Handler { on(value: Options): void }',
      'type Options = string; export interface Handler { on(value: Options): void }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Handler',
          reasons: ['declaration text changed for a checker-sensitive type'],
        }),
      ]),
    )
  })

  test('rejects constructor parameter narrowing', () => {
    const report = compare(
      'export declare class Handler { constructor(value: string | number) }',
      'export declare class Handler { constructor(value: string) }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Handler',
        reasons: ['declaration text changed for a checker-sensitive type'],
      },
    ])
  })

  test.each([
    [
      'removal',
      'export interface Config { value?: string }',
      'export interface Config {}',
    ],
    [
      'rename',
      'export interface Config { value?: string }',
      'export interface Config { renamed?: string }',
    ],
    [
      'nested removal',
      'export interface Config { options: { value?: string } }',
      'export interface Config { options: {} }',
    ],
    [
      'union branch removal',
      "export type Config = { kind: 'a'; value?: string } | { kind: 'b' }",
      "export type Config = { kind: 'a' } | { kind: 'b' }",
    ],
    [
      'inherited external removal',
      "import type { ExternalOptions } from 'external'; export interface Config extends ExternalOptions {}",
      'export interface Config {}',
    ],
  ])('rejects optional public member %s', (_, base, current) => {
    const report = compare(base, current)

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: expect.arrayContaining(['type: public member shape changed']),
      },
    ])
  })

  test.each(['string', 'number'])(
    'rejects removed %s index signatures',
    (keyType) => {
      const report = compare(
        `export interface Config { [key: ${keyType}]: string }`,
        'export interface Config {}',
      )

      expect(report.incompatible).toMatchObject([
        {
          symbol: '.:Config',
          reasons: expect.arrayContaining([
            'type: public member shape changed',
          ]),
        },
      ])
    },
  )

  test.each([
    [
      'writable field to getter',
      'export declare class Config { value: string }',
      'export declare class Config { get value(): string }',
    ],
    [
      'setter removal',
      'export declare class Config { get value(): string; set value(value: string) }',
      'export declare class Config { get value(): string }',
    ],
  ])('rejects %s', (_, base, current) => {
    const report = compare(base, current)

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: ['declaration text changed for a checker-sensitive type'],
      },
    ])
  })

  test('rejects mutable to readonly property changes', () => {
    const report = compare(
      'export interface Config { value: string }',
      'export interface Config { readonly value: string }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: ['declaration text changed for a checker-sensitive type'],
      },
    ])
  })

  test('rejects any narrowing', () => {
    const report = compare(
      'type Value = any; export interface Config { value: Value }',
      'type Value = string; export interface Config { value: Value }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Config',
          reasons: ['declaration text changed for a checker-sensitive type'],
        }),
      ]),
    )
  })

  test('still compares function properties semantically', () => {
    const report = compare(
      'export interface Handler { on: (value: string | number) => void }',
      'export interface Handler { on: (value: string) => void }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Handler',
        reasons: ['type: current is not assignable to base'],
      },
    ])
  })

  test('rejects mutable to Readonly-wrapped object property changes', () => {
    const report = compare(
      'export interface Config { value: { name: string } }',
      'export interface Config { value: Readonly<{ name: string }> }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: ['declaration text changed for a checker-sensitive type'],
      },
    ])
  })

  test('rejects mutable to readonly array property changes', () => {
    const report = compare(
      'export interface Config { items: string[] }',
      'export interface Config { items: readonly string[] }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: expect.arrayContaining([
          'type: current is not assignable to base',
        ]),
      },
    ])
  })

  test('rejects union member additions', () => {
    const report = compare(
      "export type State = 'ready'",
      "export type State = 'ready' | 'pending'",
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:State',
        reasons: ['type: current is not assignable to base'],
      },
    ])
  })

  test('keeps namespace type members text-strict', () => {
    const report = compare(
      "export declare namespace Values { const value: 'a'; type Item = 'a' }",
      "export declare namespace Values { const value: 'a'; type Item = 'b' }",
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Values',
        reasons: ['declaration text changed for a namespace'],
      },
    ])
  })

  test('keeps type-only namespaces text-strict', () => {
    const report = compare(
      "export declare namespace Types { type Item = 'a' }",
      "export declare namespace Types { type Item = 'b' }",
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Types',
        reasons: ['declaration text changed for a namespace'],
      },
    ])
  })

  test('keeps protected surfaces and their references text-strict', () => {
    const report = compare(
      'type Options = { value?: string }; export declare class Secret { protected run(options: Options): void }',
      'type Options = { value: string }; export declare class Secret { protected run(options: Options): void }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Secret',
          reasons: ['declaration text changed for a nominal class'],
        }),
      ]),
    )
  })

  test('detects inherited private members as nominal', () => {
    const report = compare(
      'declare class Base { private token; } export declare class Child extends Base { constructor(value: string) }',
      'declare class Base { private token; } export declare class Child extends Base { constructor(input: string) }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Child',
        reasons: ['declaration text changed for a nominal class'],
      },
    ])
  })

  test('does not generate probes for generic nominal classes', () => {
    const report = compare(
      'type Box<K> = { value: K }; export declare class Secret<T> { private token; read(): Box<T> }',
      'type Box<Key> = { value: Key }; export declare class Secret<T> { private token; read(): Box<T> }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Secret',
          reasons: ['declaration text changed for a nominal class'],
        }),
      ]),
    )
  })

  test('does not generate constructor probes for private constructors', () => {
    const report = compare(
      'type Box<K> = { value: K }; export declare class Secret { private constructor(); private token; read(): Box<string> }',
      'type Box<Key> = { value: Key }; export declare class Secret { private constructor(); private token; read(): Box<string> }',
    )

    expect(report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '.:Secret',
          reasons: ['declaration text changed for a nominal class'],
        }),
      ]),
    )
  })

  test('keeps changed nominal classes text-strict', () => {
    const report = compare(
      'export declare class Secret { private token; constructor(value: string) }',
      'export declare class Secret { private token; constructor(input: string) }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Secret',
        reasons: ['declaration text changed for a nominal class'],
      },
    ])
  })
})
