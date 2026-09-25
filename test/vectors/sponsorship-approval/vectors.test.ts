import { describe, expect, test } from 'vitest'
import { projectSponsorshipApproval } from '../../../src/clients/orchestrator/sponsorship-approval'
import { UnsupportedSponsorshipApprovalError } from '../../../src/errors/execution'
import { computeIntentInputDigest } from '../../../src/jwt-server/digest'
import { deriveVectors } from './derive'
import { refusedVectors } from './refused'
import vectors from './vectors.json'

// The published sponsorship approval contract (docs/sponsorship-approval.md).
// The orchestrator reimplements the projection against these same vectors.
describe('sponsorship approval vectors', () => {
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
        reason: vector.reason,
        field: vector.field,
      })
    },
  )

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
