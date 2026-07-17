import { describe, expect, test } from 'vitest'
import {
  type ArchitectureGraph,
  analyzeArchitecture,
  type DependencyEdge,
} from './check'

function graph(edges: readonly DependencyEdge[]): ArchitectureGraph {
  const files = [...new Set(edges.flatMap(({ from, to }) => [from, to]))]
  return {
    files,
    edges,
    sourceText: Object.fromEntries(files.map((file) => [file, ''])),
  }
}

describe('architecture rules', () => {
  test('rejects domain imports of concrete clients', () => {
    const violations = analyzeArchitecture(
      graph([
        {
          from: 'src/signing/execute.ts',
          to: 'src/clients/rpc/client.ts',
          typeOnly: false,
        },
      ]),
    )

    expect(violations.map(({ rule }) => rule)).toContain(
      'concrete-client-boundary',
    )
  })

  test('permits the exact deploy type edge and rejects its runtime form', () => {
    const edge = {
      from: 'src/actions/deploy.ts',
      to: 'src/api/account.ts',
    }

    expect(analyzeArchitecture(graph([{ ...edge, typeOnly: true }]))).toEqual(
      [],
    )
    expect(
      analyzeArchitecture(graph([{ ...edge, typeOnly: false }])).map(
        ({ rule }) => rule,
      ),
    ).toContain('actions-api')
  })

  test('keeps nested transaction workflows isolated', () => {
    const violations = analyzeArchitecture(
      graph([
        {
          from: 'src/transactions/intents/send.ts',
          to: 'src/transactions/user-operations/send.ts',
          typeOnly: false,
        },
      ]),
    )

    expect(violations.map(({ rule }) => rule)).toContain('workflow-isolation')
  })

  test('rejects implementation files at the transactions namespace root', () => {
    const violations = analyzeArchitecture({
      files: ['src/transactions/index.ts'],
      edges: [],
      sourceText: { 'src/transactions/index.ts': '' },
    })

    expect(violations).toContainEqual({
      rule: 'transactions-namespace-only',
      path: ['src/transactions/index.ts'],
      message:
        'transactions is a namespace; implementation belongs to a workflow subdirectory',
    })
  })

  test('reports a shortest cycle path', () => {
    const violations = analyzeArchitecture(
      graph([
        {
          from: 'src/signing/plan.ts',
          to: 'src/accounts/adapter.ts',
          typeOnly: true,
        },
        {
          from: 'src/accounts/adapter.ts',
          to: 'src/signing/plan.ts',
          typeOnly: true,
        },
        {
          from: 'src/signing/execute.ts',
          to: 'src/signing/plan.ts',
          typeOnly: true,
        },
      ]),
    )

    expect(violations).toContainEqual({
      rule: 'no-cycles',
      path: [
        'src/signing/plan.ts',
        'src/accounts/adapter.ts',
        'src/signing/plan.ts',
      ],
      message: 'rewrite import graph contains a cycle',
    })
  })
})
