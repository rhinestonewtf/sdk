import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { projectSponsorshipApproval } from '../../../src/clients/orchestrator/sponsorship-approval'
import { UnsupportedSponsorshipApprovalError } from '../../../src/errors/execution'
import { computeIntentInputDigest } from '../../../src/jwt-server/digest'
import vectors from './vectors.json'

// The frozen interim singular contract `sdk-caucasus-singular-2026-09-v1`.
// Earlier v3 snapshots send it and the orchestrator still serves it, so it must
// never change until it is removed. Its projection is the current one under a
// different identifier; the current contract's vectors live in
// ../sponsorship-approval-caucasus.
const SINGULAR_CONTRACT = 'sdk-caucasus-singular-2026-09-v1'
const SINGULAR_VECTORS_SHA256 =
  '26acac6407104ebfeea4041c9c101dd0f0e48019f51afe3804a3ec29a4772f19'

describe('singular sponsorship approval vectors (frozen)', () => {
  test('the vector file is byte-identical to the frozen contract', () => {
    const bytes = readFileSync(new URL('./vectors.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      SINGULAR_VECTORS_SHA256,
    )
  })

  test('name the contract they pin', () => {
    expect(vectors.contractVersion).toBe(SINGULAR_CONTRACT)
  })

  test.each(vectors.cases.map((vector) => [vector.id, vector] as const))(
    '%s: the body projects to the approval input and its digest',
    async (_id, vector) => {
      const projected = {
        ...projectSponsorshipApproval(vector.body),
        contractVersion: SINGULAR_CONTRACT,
      }
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
})
