import { describe, expect, test } from 'vitest'
import { compare } from './api-compat.fixture'

describe('API compatibility report: nominal surfaces', () => {
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
