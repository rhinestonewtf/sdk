import { describe, expect, test } from 'vitest'
import { compare } from './api-compat.fixture'

describe('API compatibility report: generics', () => {
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
})
