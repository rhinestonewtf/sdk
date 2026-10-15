import { readFileSync } from 'node:fs'
import { type Hex, recoverAddress, type TypedDataDefinition } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  encodeEip712Data,
  encodeErc7739ContentType,
} from '../../../src/modules/validators/smart-sessions/erc7739'
import { encodeSmartSessionContribution } from '../../../src/modules/validators/smart-sessions/signature'
import {
  hashErc7739TypedData,
  prepareSmartSessionErc7739Signing,
} from '../../../src/signing/protocols/erc7739'

// Generated with viem by scripts/erc7739-encodedata-vectors.mjs; the
// smart-sessions-v2 emissary tests validate the same vectors on-chain.
const fixture = JSON.parse(
  readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'),
  (_key, value) =>
    value !== null && typeof value === 'object' && '$bigint' in value
      ? BigInt(value.$bigint)
      : value,
) as {
  readonly signer: Hex
  readonly accountDomain: Parameters<
    typeof hashErc7739TypedData
  >[0]['verifierDomain']
  readonly permissionId: Hex
  readonly policyData: Hex
  readonly vectors: readonly {
    readonly label: string
    readonly typedData: TypedDataDefinition
    readonly contentsType: string
    readonly description: string
    readonly appDomainSeparator: Hex
    readonly encodeData: Hex
    readonly digest: Hex
    readonly signature: Hex
    readonly expectValid: boolean
    readonly envelope: Hex
  }[]
}

// The SDK emits implicit-mode descriptions and signs the digest the emissary
// derives, so only those vectors describe what it produces.
const emitted = fixture.vectors.filter(
  (vector) => vector.expectValid && vector.description === vector.contentsType,
)

describe('ERC-7739 Smart Session vectors', () => {
  test('cover every valid implicit-mode vector', () => {
    expect(emitted.length).toBe(13)
  })

  test.each(emitted.map((vector) => [vector.label, vector] as const))(
    '%s',
    async (_label, vector) => {
      const { typedData } = vector
      const types = typedData.types as Parameters<
        typeof encodeEip712Data
      >[0]['types']
      const primaryType = typedData.primaryType as string
      const prepared = prepareSmartSessionErc7739Signing({
        typedData,
        verifierDomain: fixture.accountDomain,
      })

      expect(
        encodeEip712Data({
          primaryType,
          types,
          message: typedData.message as Record<string, unknown>,
        }),
      ).toBe(vector.encodeData)
      expect(encodeErc7739ContentType({ primaryType, types })).toBe(
        vector.contentsType,
      )
      expect(prepared).toEqual({
        appDomainSeparator: vector.appDomainSeparator,
        contentsType: vector.contentsType,
        encodeData: vector.encodeData,
        digest: vector.digest,
      })
      expect(
        hashErc7739TypedData({
          typedData,
          verifierDomain: fixture.accountDomain,
        }),
      ).toBe(vector.digest)
      expect(
        await recoverAddress({
          hash: prepared.digest,
          signature: vector.signature,
        }),
      ).toBe(fixture.signer)
      expect(
        encodeSmartSessionContribution({
          mode: 'notarized-typed',
          permissionId: fixture.permissionId,
          signature: vector.signature,
          claimPolicyData: fixture.policyData,
          erc7739: prepared,
        }),
      ).toBe(vector.envelope)
    },
  )
})
