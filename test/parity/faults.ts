import type { ApiVersion, Op } from './routing'

// Deliberate breakage applied to the candidate's outgoing request, to prove a
// broken mapping surfaces as a diff.
interface Fault {
  id: string
  op: Op
  description: string
  transform(body: any, apiVersion: ApiVersion): any
}

// Both API versions' names: alps `destinationGasUnits`, blanc `destinationGasLimit`.
const OPTIONAL_FIELDS = [
  'recipient',
  'accountAccessList',
  'preClaimExecutions',
  'destinationGasUnits',
  'destinationGasLimit',
]
const OPTIONAL_ACCOUNT_FIELDS = [
  'mockSignature',
  'mockSignatures',
  'delegations',
]

const FAULTS: Fault[] = [
  {
    id: 'quote.bump-token-amount',
    op: 'quote',
    description:
      'tokenRequests[0].amount + 1; expect a quoteRequest diff at /tokenRequests/0/amount',
    transform(body) {
      const request = body?.tokenRequests?.[0]
      if (request?.amount !== undefined) {
        request.amount = (BigInt(request.amount) + 1n).toString()
      }
      return body
    },
  },
  {
    id: 'quote.drop-auxiliary-funds',
    op: 'quote',
    description:
      'deletes options.auxiliaryFunds; expect a quoteRequest diff at /options/auxiliaryFunds and a ZERO_BALANCE errors diff',
    transform(body) {
      if (body?.options) delete body.options.auxiliaryFunds
      return body
    },
  },
  {
    id: 'quote.drop-options',
    op: 'quote',
    description:
      'deletes every quote option except auxiliaryFunds (kept so quotes still find a balance); expect a quoteRequest diff at /<step>/options/<key> for each option a step sets',
    transform(body) {
      const options = body?.options
      if (options && typeof options === 'object') {
        for (const key of Object.keys(options)) {
          if (key !== 'auxiliaryFunds') delete options[key]
        }
      }
      return body
    },
  },
  {
    id: 'quote.drop-optional-fields',
    op: 'quote',
    description:
      'deletes recipient, the access list, pre-claim executions, the gas limit, destination executions and the account mock signatures and delegations; expect a quoteRequest diff naming each one a step sets',
    transform(body) {
      if (!body || typeof body !== 'object') return body
      for (const key of OPTIONAL_FIELDS) delete body[key]
      if (
        Array.isArray(body.destinationExecutions) &&
        body.destinationExecutions.length > 0
      ) {
        body.destinationExecutions = []
      }
      const account = body.account
      if (account && typeof account === 'object') {
        for (const key of OPTIONAL_ACCOUNT_FIELDS) delete account[key]
      }
      return body
    },
  },
]

function getFault(id: string): Fault {
  const fault = FAULTS.find((candidate) => candidate.id === id)
  if (!fault) {
    throw new Error(
      `Unknown PARITY_FAULT "${id}"; known: ${FAULTS.map((f) => f.id).join(', ')}`,
    )
  }
  return fault
}

export type { Fault }
export { getFault }
