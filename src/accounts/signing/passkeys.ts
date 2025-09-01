import {
  type Address,
  bytesToHex,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
} from 'viem'

interface WebAuthnSignature {
  authenticatorData: Hex
  clientDataJSON: string
  challengeIndex: bigint
  typeIndex: bigint
  r: bigint
  s: bigint
}

function parsePublicKey(publicKey: Hex | Uint8Array): {
  x: bigint
  y: bigint
} {
  const bytes =
    typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
  const offset = bytes.length === 65 ? 1 : 0
  const x = bytes.slice(offset, 32 + offset)
  const y = bytes.slice(32 + offset, 64 + offset)
  return {
    x: BigInt(bytesToHex(x)),
    y: BigInt(bytesToHex(y)),
  }
}

function parseSignature(signature: Hex | Uint8Array): {
  r: bigint
  s: bigint
} {
  const bytes =
    typeof signature === 'string' ? hexToBytes(signature) : signature
  const r = bytes.slice(0, 32)
  const s = bytes.slice(32, 64)
  return {
    r: BigInt(bytesToHex(r)),
    s: BigInt(bytesToHex(s)),
  }
}

function generateCredentialId(
  pubKeyX: bigint,
  pubKeyY: bigint,
  account: Address,
) {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'uint256',
        },
        {
          type: 'uint256',
        },
        {
          type: 'address',
        },
      ],
      [pubKeyX, pubKeyY, account],
    ),
  )
}

function packSignature(
  credIds: Hex[],
  usePrecompile: boolean,
  webAuthns: {
    authenticatorData: Hex
    clientDataJSON: string
    challengeIndex: bigint
    typeIndex: bigint
    r: bigint
    s: bigint
  }[],
): Hex {
  // Sort both `credIds` and `webAuthns` by credIds
  const credIdsAndWebAuthns = credIds.map((credId, index) => ({
    credId,
    webAuthn: webAuthns[index],
  }))
  credIdsAndWebAuthns.sort((a, b) => a.credId.localeCompare(b.credId))
  credIds = credIdsAndWebAuthns.map(({ credId }) => credId)
  webAuthns = credIdsAndWebAuthns.map(({ webAuthn }) => webAuthn)
  // Encode
  return encodeAbiParameters(
    [
      {
        type: 'bytes32[]',
        name: 'credIds',
      },
      {
        type: 'bool',
        name: 'usePrecompile',
      },
      {
        type: 'tuple[]',
        name: 'webAuthns',
        components: [
          {
            type: 'bytes',
            name: 'authenticatorData',
          },
          {
            type: 'string',
            name: 'clientDataJSON',
          },
          {
            type: 'uint256',
            name: 'challengeIndex',
          },
          {
            type: 'uint256',
            name: 'typeIndex',
          },
          {
            type: 'uint256',
            name: 'r',
          },
          {
            type: 'uint256',
            name: 's',
          },
        ],
      },
    ],
    [credIds, usePrecompile, webAuthns],
  )
}

function packSignatureV0(
  webauthn: {
    authenticatorData: Hex
    clientDataJSON: string
    typeIndex: number | bigint
    r: bigint
    s: bigint
  },
  usePrecompiled: boolean,
) {
  return encodeAbiParameters(
    [
      { type: 'bytes', name: 'authenticatorData' },
      {
        type: 'string',
        name: 'clientDataJSON',
      },
      {
        type: 'uint256',
        name: 'responseTypeLocation',
      },
      {
        type: 'uint256',
        name: 'r',
      },
      {
        type: 'uint256',
        name: 's',
      },
      {
        type: 'bool',
        name: 'usePrecompiled',
      },
    ],
    [
      webauthn.authenticatorData,
      webauthn.clientDataJSON,
      typeof webauthn.typeIndex === 'bigint'
        ? webauthn.typeIndex
        : BigInt(webauthn.typeIndex),
      webauthn.r,
      webauthn.s,
      usePrecompiled,
    ],
  )
}

export {
  parsePublicKey,
  parseSignature,
  generateCredentialId,
  packSignature,
  packSignatureV0,
}
export type { WebAuthnSignature }
