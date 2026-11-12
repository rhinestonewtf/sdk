import type { ApiVersion, Op } from './routing'

// Deliberate breakage applied to the candidate's outgoing request, to prove a
// broken mapping surfaces as a diff.
interface Fault {
  id: string
  op: Op
  description: string
  transform(body: any, apiVersion: ApiVersion): any
}

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
export { FAULTS, getFault }
