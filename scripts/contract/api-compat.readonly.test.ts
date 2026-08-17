import { describe, expect, test } from 'vitest'
import { compare } from './api-compat.fixture'

describe('API compatibility report: readonly and accessors', () => {
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
})
