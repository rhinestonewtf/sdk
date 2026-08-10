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
  const consumer = join(root, 'consumer')
  mkdirSync(join(consumer, 'node_modules/@rhinestone'), { recursive: true })
  cpSync(base, join(consumer, 'node_modules/@rhinestone/sdk-base'), {
    recursive: true,
  })
  cpSync(current, join(consumer, 'node_modules/@rhinestone/sdk'), {
    recursive: true,
  })
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

  test('rejects mutable to readonly property changes', () => {
    const report = compare(
      'export interface Config { items: string[] }',
      'export interface Config { items: readonly string[] }',
    )

    expect(report.incompatible).toMatchObject([
      {
        symbol: '.:Config',
        reasons: ['type: current is not assignable to base'],
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
