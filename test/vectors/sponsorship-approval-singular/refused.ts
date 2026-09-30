// Request shapes the singular approval contract refuses. Each is a supported
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
      body: from('evm-same-chain-exact-out', (body) => {
        body.metadata = { note: 'x' }
      }),
    },
    {
      id: 'unknown-option',
      field: 'options.dryRun',
      body: from('evm-same-chain-exact-out', (body) => {
        body.options.dryRun = true
      }),
    },
    {
      id: 'unknown-account-key',
      field: 'account.evm.label',
      body: from('evm-same-chain-exact-out', (body) => {
        body.account.evm.label = 'x'
      }),
    },
    {
      id: 'unknown-source-key',
      field: 'source.chains',
      body: from('evm-max-output', (body) => {
        body.source.chains = [body.source.chainId]
      }),
    },
    {
      id: 'unknown-destination-key',
      field: 'destination.memo',
      body: from('evm-same-chain-exact-out', (body) => {
        body.destination.memo = 'x'
      }),
    },
    {
      id: 'legacy-token-requests',
      field: 'destination.tokenRequests',
      body: from('evm-same-chain-exact-out', (body) => {
        body.destination.tokenRequests = [
          {
            tokenAddress: body.destination.token,
            amount: body.destination.amount,
          },
        ]
      }),
    },
    {
      id: 'legacy-source-selection',
      field: 'source.selection',
      body: from('evm-max-output', (body) => {
        body.source.selection = {
          chains: { only: [body.source.chainId] },
          tokens: 'all',
        }
      }),
    },
    {
      id: 'legacy-source-limits',
      field: 'source.limits',
      body: from('evm-max-output', (body) => {
        body.source.limits = [
          {
            chainId: body.source.chainId,
            tokenAddress: body.source.token,
            maxAmount: body.source.maxAmount,
          },
        ]
      }),
    },
    {
      id: 'legacy-source-executions',
      field: 'source.executions',
      body: from('evm-cross-chain-source-calls', (body) => {
        body.source.executions = [
          {
            vm: 'evm',
            chainId: body.source.chainId,
            calls: body.source.execution.calls,
          },
        ]
        delete body.source.execution
      }),
    },
    {
      id: 'null-destination-amount',
      field: 'destination.amount',
      body: from('evm-same-chain-exact-out', (body) => {
        body.destination.amount = null
      }),
    },
    {
      id: 'null-source-max-amount',
      field: 'source.maxAmount',
      body: from('evm-max-output', (body) => {
        body.source.maxAmount = null
      }),
    },
    {
      id: 'numeric-amount',
      field: 'destination.amount',
      body: from('evm-same-chain-exact-out', (body) => {
        body.destination.amount = 1_000_000
      }),
    },
    {
      id: 'numeric-auxiliary-funds',
      field: 'source.auxiliaryFunds',
      body: from('evm-cross-chain-source-calls', (body) => {
        body.source.auxiliaryFunds = 750_000
      }),
    },
    {
      id: 'svm-source-execution',
      field: 'source.execution',
      body: from('solana-transfer', (body) => {
        body.source.execution = {
          calls: [
            {
              to: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
              value: '0',
              data: '0x',
            },
          ],
        }
      }),
    },
    {
      id: 'tron-execution',
      field: 'destination.execution',
      body: from('evm-to-tron', (body) => {
        body.destination.execution = { calls: [] }
      }),
    },
    {
      id: 'recipient-signature-mode',
      field: 'destination.recipient.signatureMode',
      body: from('evm-typed-recipient', (body) => {
        body.destination.recipient.signatureMode = 1
      }),
    },
    {
      id: 'non-boolean-sponsorship',
      field: 'options.sponsorship.gas',
      body: from('evm-same-chain-exact-out', (body) => {
        body.options.sponsorship.gas = 'true'
      }),
    },
    {
      id: 'authority-with-instructions',
      field: 'destination.execution.instructions',
      body: from('solana-authority-add-passkey', (body) => {
        body.destination.execution.instructions = []
      }),
    },
  ]
}
