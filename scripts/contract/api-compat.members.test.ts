import { describe, expect, test } from 'vitest'
import { compare } from './api-compat.fixture'

describe('API compatibility report: member shape', () => {
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
})
