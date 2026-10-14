import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { UnsupportedSponsorshipApprovalError } from '../../../src/errors/execution'
import { computeIntentInputDigest } from '../../../src/jwt-server/digest'
import { projectSponsorshipApproval } from './legacy-projection'
import vectors from './vectors.json'

// The frozen legacy sponsorship approval contract. The SDK no longer sends it,
// but the orchestrator serves it to older pinned clients and copies this file
// verbatim as its legacy fixture, so it must never change. The current
// contract's vectors live in ../sponsorship-approval-caucasus.
const LEGACY_VECTORS_SHA256 =
  '3292c83e17d948cdc93602081aaa9e7b7a90da6c93de47793f2c468dc89a4f12'

describe('legacy sponsorship approval vectors (frozen)', () => {
  test('the vector file is byte-identical to the frozen contract', () => {
    const bytes = readFileSync(new URL('./vectors.json', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      LEGACY_VECTORS_SHA256,
    )
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
        reason: vector.reason,
        field: vector.field,
      })
    },
  )
})
