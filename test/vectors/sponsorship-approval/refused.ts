// Request shapes the approval input cannot represent. Each is a supported
// vector's body with one change, so it reads as the smallest step outside the
// contract; the orchestrator must refuse every one of them too.

export interface RefusedVector {
  readonly id: string
  readonly body: unknown
  readonly field: string
}

type Body = Record<string, any>

export function refusedVectors(
  bodies: Readonly<Record<string, unknown>>,
): readonly RefusedVector[] {
  const from = (id: string, change: (body: Body) => void): Body => {
    const body = structuredClone(bodies[id]) as Body
    if (!body) throw new Error(`No vector ${id} to derive a refusal from`)
    change(body)
    return body
  }
  return [
    {
      id: 'unknown-root-key',
      field: 'metadata',
      body: from('evm-same-chain-transfer', (body) => {
        body.metadata = { note: 'x' }
      }),
    },
    {
      id: 'unknown-option',
      field: 'options.dryRun',
      body: from('evm-same-chain-transfer', (body) => {
        body.options.dryRun = true
      }),
    },
    {
      id: 'selection-strategy',
      field: 'options.selectionStrategy',
      body: from('evm-cross-chain-source-chains', (body) => {
        body.options.selectionStrategy = 'cheapest'
      }),
    },
    {
      id: 'execution-tokens-received',
      field: 'destination.execution.executionTokensReceived',
      body: from('evm-destination-calls-gas-limit', (body) => {
        body.destination.execution.executionTokensReceived = [
          body.destination.tokenRequests[0].tokenAddress,
        ]
      }),
    },
    {
      id: 'excluded-chains',
      field: 'source.selection.chains.except',
      body: from('evm-cross-chain-source-chains', (body) => {
        body.source.selection.chains = { except: ['eip155:10'] }
      }),
    },
    {
      id: 'excluded-tokens',
      field: 'source.selection.tokens.except',
      body: from('evm-source-chains-token-list', (body) => {
        body.source.selection.tokens = {
          except: body.source.selection.tokens.only,
        }
      }),
    },
    {
      id: 'limit-without-per-chain',
      field: 'source.limits',
      body: from('evm-cross-chain-source-chains', (body) => {
        body.source.limits = [
          {
            chainId: 'eip155:1',
            tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            maxAmount: '1',
          },
        ]
      }),
    },
    {
      id: 'tokens-wider-than-per-chain',
      field: 'source.selection.tokens',
      body: from('evm-source-assets-per-chain', (body) => {
        body.source.selection.tokens.only.push(
          '0x0000000000000000000000000000000000000001',
        )
      }),
    },
    {
      id: 'per-chain-delegations',
      field: 'account.evm.delegations.chains',
      body: from('evm-eip7702', (body) => {
        const { contract } = body.account.evm.delegations.default
        body.account.evm.delegations = {
          chains: { 'eip155:8453': { contract } },
        }
      }),
    },
    {
      id: 'chain-agnostic-mock-signature',
      field: 'account.evm.simulation.mockSignature',
      body: from('evm-smart-session', (body) => {
        body.account.evm.simulation = { mockSignature: `0x${'5e'.repeat(65)}` }
      }),
    },
    {
      id: 'two-hypercore-actions',
      field: 'destination.execution.actions',
      body: from('evm-hypercore-action', (body) => {
        const [action] = body.destination.execution.actions
        body.destination.execution.actions = [action, action]
      }),
    },
    {
      id: 'unknown-caip2',
      field: 'destination.chainId',
      body: from('evm-to-tron', (body) => {
        body.destination.chainId = 'tron:shasta'
      }),
    },
  ]
}
