import { describe, expect, test } from 'vitest'
import {
  projectSponsorshipApproval,
  SPONSORSHIP_APPROVAL_CONTRACT,
} from '../../../src/clients/orchestrator/sponsorship-approval'
import { UnsupportedSponsorshipApprovalError } from '../../../src/errors/execution'
import { computeIntentInputDigest } from '../../../src/jwt-server/digest'
import { deriveVectors } from './derive'
import { refusedVectors } from './refused'
import vectors from './vectors.json'

// The published singular sponsorship approval contract
// (docs/sponsorship-approval.md). The orchestrator imports these vectors as its
// fixture for `sdk-caucasus-singular-2026-09-v1`.
describe('singular sponsorship approval vectors', () => {
  test('name the contract they pin', () => {
    expect(vectors.contractVersion).toBe(SPONSORSHIP_APPROVAL_CONTRACT)
    for (const vector of vectors.cases) {
      expect(vector.intentInput.contractVersion).toBe(
        SPONSORSHIP_APPROVAL_CONTRACT,
      )
    }
  })

  test.each(vectors.cases.map((vector) => [vector.id, vector] as const))(
    '%s: the body projects to the approval input and its digest',
    async (_id, vector) => {
      const projected = projectSponsorshipApproval(vector.body)
      expect(projected).toEqual(vector.intentInput)
      expect(await computeIntentInputDigest(projected)).toBe(vector.digest)
    },
  )

  test.each(vectors.refused.map((vector) => [vector.id, vector] as const))(
    '%s: the body is refused',
    (_id, vector) => {
      let error: unknown
      try {
        projectSponsorshipApproval(vector.body)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(UnsupportedSponsorshipApprovalError)
      expect((error as UnsupportedSponsorshipApprovalError).context).toEqual({
        reason: 'unsupported',
        field: vector.field,
      })
    },
  )

  test('the same-chain shorthand approves exactly like the explicit source', () => {
    const digest = (id: string) =>
      vectors.cases.find((vector) => vector.id === id)?.digest
    expect(digest('evm-same-chain-exact-out')).toBeDefined()
    expect(digest('evm-same-chain-exact-out')).toBe(
      digest('evm-same-chain-explicit-source'),
    )
  })

  test('a changed bound field changes the digest', async () => {
    const vector = vectors.cases.find(
      ({ id }) => id === 'evm-same-chain-exact-out',
    )!
    const body = structuredClone(vector.body) as {
      destination: { amount: string }
    }
    body.destination.amount = '1000001'
    expect(
      await computeIntentInputDigest(projectSponsorshipApproval(body)),
    ).not.toBe(vector.digest)
  })

  // Rebuilt from the SDK on every run, so a vector cannot drift from what a
  // sponsored quote actually sends and what the integrator is asked to approve.
  test('matches what the SDK sends and asks the integrator to approve', async () => {
    const derived = await deriveVectors()
    expect(
      derived.map(({ id, body, intentInput }) => ({ id, body, intentInput })),
    ).toEqual(
      vectors.cases.map(({ id, body, intentInput }) => ({
        id,
        body,
        intentInput,
      })),
    )
    expect(
      refusedVectors(
        Object.fromEntries(derived.map(({ id, body }) => [id, body])),
      ).map(({ id, body, field }) => ({ id, body, field })),
    ).toEqual(
      vectors.refused.map(({ id, body, field }) => ({ id, body, field })),
    )
  })
})
