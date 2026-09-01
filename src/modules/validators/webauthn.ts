import {
  type Address,
  bytesToHex,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  stringToBytes,
} from 'viem'
import type { ResolvedModule } from '../types'
import { compareHexValues } from './ordering'
import type { AtomicValidatorDefinition } from './types'

export const WEBAUTHN_VALIDATOR_ADDRESS: Address =
  '0x0000000000578c4cb0e472a5462da43c495c3f33'
export const WEBAUTHN_V0_VALIDATOR_ADDRESS = WEBAUTHN_VALIDATOR_ADDRESS

// The account address carried by a stateless WebAuthn configuration. The
// validator only uses it to re-derive the credential IDs in the same blob and
// check they match, never to read storage, so any constant works as long as the
// IDs are derived from it. The real account address cannot be used: it is
// derived from the init data that would contain it.
export const WEBAUTHN_STATELESS_ACCOUNT: Address =
  '0x0000000000000000000000000000000000000000'

export const WEBAUTHN_MOCK_SIGNATURE =
  '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001b9b86eb98fda3ed4d797d9e690588dfadf17b329a76a47cec935bebf92d7ddc80000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000001700000000000000000000000000000000000000000000000000000000000000019b2e9410bb6850f9f660a03d609d5a844fb96bcdc87a15139b03ee22c70f469100d2b865a215c3bf786387064effa8fcedcb1d625b5148f8a1236d5e3ff11acf000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a38303830222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000' as const

export interface PublicKey {
  prefix?: number | undefined
  x: bigint
  y: bigint
}

export interface WebauthnCredential {
  pubKey: PublicKey | Hex | Uint8Array
  authenticatorId: string
}

export interface WebAuthnSignature {
  authenticatorData: Hex
  clientDataJSON: string
  challengeIndex: bigint
  typeIndex: bigint
  r: bigint
  s: bigint
}

type NormalizedWebAuthnSignature = WebAuthnSignature & {
  challengeIndex: bigint
  typeIndex: bigint
}

const P256_CURVE_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const P256_HALF_CURVE_ORDER = P256_CURVE_ORDER / 2n
const WEBAUTHN_TYPE_LITERAL = stringToBytes('"type":"webauthn.get"')
const WEBAUTHN_CHALLENGE_LITERAL = stringToBytes('"challenge":"')

function findClientDataLiteral(
  clientData: Uint8Array,
  literal: Uint8Array,
  name: 'type' | 'challenge',
): bigint {
  const lastStart = clientData.length - literal.length
  for (let start = 0; start <= lastStart; start++) {
    if (literal.every((byte, offset) => clientData[start + offset] === byte)) {
      return BigInt(start)
    }
  }
  throw new Error(
    `WebAuthn clientDataJSON is missing the required ${name} field`,
  )
}

function normalizeP256S(s: bigint): bigint {
  return s > P256_HALF_CURVE_ORDER ? P256_CURVE_ORDER - s : s
}

function normalizeWebauthnSignature(
  signature: WebAuthnSignature,
): NormalizedWebAuthnSignature {
  const clientData = stringToBytes(signature.clientDataJSON)
  return {
    ...signature,
    challengeIndex: findClientDataLiteral(
      clientData,
      WEBAUTHN_CHALLENGE_LITERAL,
      'challenge',
    ),
    typeIndex: findClientDataLiteral(clientData, WEBAUTHN_TYPE_LITERAL, 'type'),
    s: normalizeP256S(signature.s),
  }
}

function normalizeWebauthnSignatureV0(
  signature: Omit<WebAuthnSignature, 'challengeIndex'>,
): Omit<NormalizedWebAuthnSignature, 'challengeIndex'> {
  const clientData = stringToBytes(signature.clientDataJSON)
  return {
    ...signature,
    typeIndex: findClientDataLiteral(clientData, WEBAUTHN_TYPE_LITERAL, 'type'),
    s: normalizeP256S(signature.s),
  }
}

export function parseWebauthnPublicKey(publicKey: Hex | Uint8Array): PublicKey {
  const bytes =
    typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey
  const offset = bytes.length === 65 ? 1 : 0
  const prefix = offset === 1 ? bytes[0] : undefined
  return {
    ...(prefix === undefined ? {} : { prefix }),
    x: BigInt(bytesToHex(bytes.slice(offset, 32 + offset))),
    y: BigInt(bytesToHex(bytes.slice(32 + offset, 64 + offset))),
  }
}

export function parseWebauthnSignature(signature: Hex | Uint8Array): {
  readonly r: bigint
  readonly s: bigint
} {
  const bytes =
    typeof signature === 'string' ? hexToBytes(signature) : signature
  return {
    r: BigInt(bytesToHex(bytes.slice(0, 32))),
    s: BigInt(bytesToHex(bytes.slice(32, 64))),
  }
}

export function generateWebauthnCredentialId(
  pubKeyX: bigint,
  pubKeyY: bigint,
  account: Address,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
      [pubKeyX, pubKeyY, account],
    ),
  )
}

const WEBAUTHN_AUTH_ABI = {
  type: 'tuple[]',
  name: 'webAuthns',
  components: [
    { type: 'bytes', name: 'authenticatorData' },
    { type: 'string', name: 'clientDataJSON' },
    { type: 'uint256', name: 'challengeIndex' },
    { type: 'uint256', name: 'typeIndex' },
    { type: 'uint256', name: 'r' },
    { type: 'uint256', name: 's' },
  ],
} as const

// The same mock assertion `WEBAUTHN_MOCK_SIGNATURE` carries, in the shape the
// stateless path expects, so a passkey factor can be gas-estimated.
export function webauthnStatelessMockSignature(): Hex {
  return encodeAbiParameters(
    [WEBAUTHN_AUTH_ABI],
    [
      decodeAbiParameters(
        [
          { type: 'bytes32[]', name: 'credIds' },
          { type: 'bool', name: 'usePrecompile' },
          WEBAUTHN_AUTH_ABI,
        ],
        WEBAUTHN_MOCK_SIGNATURE,
      )[2],
    ],
  )
}

export function encodeWebauthnSignatures(
  credentialIds: readonly Hex[],
  usePrecompile: boolean,
  signatures: readonly WebAuthnSignature[],
): Hex {
  const ordered = credentialIds
    .map((credentialId, index) => ({
      credentialId,
      signature: normalizeWebauthnSignature(signatures[index]),
    }))
    .sort((left, right) =>
      compareHexValues(left.credentialId, right.credentialId),
    )
  return encodeAbiParameters(
    [
      { type: 'bytes32[]', name: 'credIds' },
      { type: 'bool', name: 'usePrecompile' },
      WEBAUTHN_AUTH_ABI,
    ],
    [
      ordered.map(({ credentialId }) => credentialId),
      usePrecompile,
      ordered.map(({ signature }) => signature),
    ],
  )
}

// The signature format the validator's stateless path expects: the assertions
// alone, paired with the configuration's credentials by position.
export function encodeWebauthnStatelessSignatures(
  signatures: readonly WebAuthnSignature[],
): Hex {
  return encodeAbiParameters(
    [WEBAUTHN_AUTH_ABI],
    [signatures.map(normalizeWebauthnSignature)],
  )
}

export function encodeWebauthnSignatureV0(
  signature: Omit<WebAuthnSignature, 'challengeIndex'>,
  usePrecompile: boolean,
): Hex {
  const normalized = normalizeWebauthnSignatureV0(signature)
  return encodeAbiParameters(
    [
      { type: 'bytes', name: 'authenticatorData' },
      { type: 'string', name: 'clientDataJSON' },
      { type: 'uint256', name: 'responseTypeLocation' },
      { type: 'uint256', name: 'r' },
      { type: 'uint256', name: 's' },
      { type: 'bool', name: 'usePrecompiled' },
    ],
    [
      normalized.authenticatorData,
      normalized.clientDataJSON,
      normalized.typeIndex,
      normalized.r,
      normalized.s,
      usePrecompile,
    ],
  )
}

// Orders owners the way the stateless configuration lays their credentials out.
function statelessCredentialOrder(
  credentials: readonly { readonly ownerId: string; readonly publicKey: Hex }[],
): readonly string[] {
  return [...credentials]
    .map((credential) => {
      const publicKey = parseWebauthnPublicKey(credential.publicKey)
      return {
        ownerId: credential.ownerId,
        credentialId: generateWebauthnCredentialId(
          publicKey.x,
          publicKey.y,
          WEBAUTHN_STATELESS_ACCOUNT,
        ),
      }
    })
    .sort((left, right) =>
      compareHexValues(left.credentialId, right.credentialId),
    )
    .map(({ ownerId }) => ownerId)
}

export function encodeWebauthnValidatorContribution(input: {
  readonly ownerOrder: readonly string[]
  readonly threshold: number
  readonly account: Address
  readonly usePrecompile: boolean
  readonly format: 'current' | 'v0' | 'stateless'
  readonly credentials?: readonly {
    readonly ownerId: string
    readonly publicKey: Hex
  }[]
  readonly contributions: readonly {
    readonly ownerId: string
    readonly publicKey: Hex
    readonly signature: Hex
    readonly authenticatorData: Hex
    readonly clientDataJSON: string
    readonly challengeIndex: number
    readonly typeIndex: number
  }[]
}): Hex {
  if (input.threshold < 1 || input.threshold > input.ownerOrder.length) {
    throw new Error('Validator threshold is outside the configured owner set')
  }
  const configured = new Set(input.ownerOrder)
  const contributions = new Map<string, (typeof input.contributions)[number]>()
  for (const contribution of input.contributions) {
    if (!configured.has(contribution.ownerId)) {
      throw new Error(`Unknown validator owner ${contribution.ownerId}`)
    }
    if (contributions.has(contribution.ownerId)) {
      throw new Error(`Duplicate validator owner ${contribution.ownerId}`)
    }
    contributions.set(contribution.ownerId, contribution)
  }
  const ordered = input.ownerOrder.flatMap((ownerId) => {
    const contribution = contributions.get(ownerId)
    return contribution ? [contribution] : []
  })
  if (ordered.length < input.threshold) {
    throw new Error(
      `Insufficient validator contributions: required ${input.threshold}, received ${ordered.length}`,
    )
  }
  const signatures = ordered.map(
    (contribution): WebAuthnSignature => ({
      authenticatorData: contribution.authenticatorData,
      clientDataJSON: contribution.clientDataJSON,
      challengeIndex: BigInt(contribution.challengeIndex),
      typeIndex: BigInt(contribution.typeIndex),
      ...parseWebauthnSignature(contribution.signature),
    }),
  )
  if (input.format === 'v0') {
    if (signatures.length !== 1) {
      throw new Error('WebAuthn V0 accepts exactly one contribution')
    }
    return encodeWebauthnSignatureV0(signatures[0], input.usePrecompile)
  }
  if (input.format === 'stateless') {
    if (!input.credentials) {
      throw new Error(
        'Stateless WebAuthn contributions require the configured credentials',
      )
    }
    const configuredOrder = statelessCredentialOrder(input.credentials)
    const signingOrder = statelessCredentialOrder(
      ordered.map((contribution) => ({
        ownerId: contribution.ownerId,
        publicKey: contribution.publicKey,
      })),
    )
    const expected = configuredOrder.slice(0, signingOrder.length)
    if (signingOrder.some((ownerId, index) => expected[index] !== ownerId)) {
      throw new Error(
        'A WebAuthn factor pairs each signature with the credential at the same position, so a partial signer set must be the lowest-ordered credentials of that factor',
      )
    }
    const byOwnerId = new Map(
      ordered.map((contribution, index) => [
        contribution.ownerId,
        signatures[index],
      ]),
    )
    return encodeWebauthnStatelessSignatures(
      signingOrder.map(
        (ownerId) => byOwnerId.get(ownerId) as WebAuthnSignature,
      ),
    )
  }
  const credentialIds = ordered.map((contribution) => {
    const publicKey = parseWebauthnPublicKey(contribution.publicKey)
    return generateWebauthnCredentialId(publicKey.x, publicKey.y, input.account)
  })
  return encodeWebauthnSignatures(
    credentialIds,
    input.usePrecompile,
    signatures,
  )
}

export interface WebauthnInstallCredential {
  readonly pubKeyX: bigint
  readonly pubKeyY: bigint
  readonly requireUV: boolean
}

// How the credentials are laid out in the validator's install data. The
// validator requires `keccak(x, y, account)` strictly ascending, but that order
// depends on the account address, which depends on the install data — so the
// address-independent `canonical` order is what the salt search grinds against,
// and `credential-id` is only usable once the address is already fixed.
export type WebauthnCredentialOrdering =
  | { readonly kind: 'as-provided' }
  | { readonly kind: 'canonical' }
  | { readonly kind: 'credential-id'; readonly account: Address }

export function toWebauthnInstallCredentials(
  credentials: readonly WebauthnCredential[],
): readonly WebauthnInstallCredential[] {
  return credentials.map((credential) => {
    const publicKey =
      typeof credential.pubKey === 'object' &&
      !(credential.pubKey instanceof Uint8Array)
        ? credential.pubKey
        : parseWebauthnPublicKey(credential.pubKey)
    return {
      pubKeyX: publicKey.x,
      pubKeyY: publicKey.y,
      requireUV: false,
    }
  })
}

function comparePublicKeys(
  left: WebauthnInstallCredential,
  right: WebauthnInstallCredential,
): number {
  if (left.pubKeyX !== right.pubKeyX) {
    return left.pubKeyX < right.pubKeyX ? -1 : 1
  }
  if (left.pubKeyY === right.pubKeyY) return 0
  return left.pubKeyY < right.pubKeyY ? -1 : 1
}

export function orderWebauthnCredentials(
  credentials: readonly WebauthnInstallCredential[],
  ordering: WebauthnCredentialOrdering,
): readonly WebauthnInstallCredential[] {
  switch (ordering.kind) {
    case 'as-provided':
      return credentials
    case 'canonical':
      return [...credentials].sort(comparePublicKeys)
    case 'credential-id': {
      const account = ordering.account
      return [...credentials].sort((left, right) =>
        compareHexValues(
          generateWebauthnCredentialId(left.pubKeyX, left.pubKeyY, account),
          generateWebauthnCredentialId(right.pubKeyX, right.pubKeyY, account),
        ),
      )
    }
  }
}

// The validator's `onInstall` predicate: credential IDs strictly ascending,
// which also rules out duplicates.
export function webauthnCredentialsAreAscending(
  credentials: readonly WebauthnInstallCredential[],
  account: Address,
): boolean {
  let previous: Hex | undefined
  for (const credential of credentials) {
    const credentialId = generateWebauthnCredentialId(
      credential.pubKeyX,
      credential.pubKeyY,
      account,
    )
    if (
      previous !== undefined &&
      compareHexValues(previous, credentialId) >= 0
    ) {
      return false
    }
    previous = credentialId
  }
  return true
}

export function hasDuplicateWebauthnCredentials(
  credentials: readonly WebauthnInstallCredential[],
): boolean {
  const seen = new Set<string>()
  for (const credential of credentials) {
    const key = `${credential.pubKeyX}:${credential.pubKeyY}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function resolveWebauthnCredentials(input: {
  readonly credentials: readonly WebauthnCredential[]
  readonly threshold: number
  readonly address?: `0x${string}`
  readonly ordering?: WebauthnCredentialOrdering
}): ResolvedModule {
  const credentials = orderWebauthnCredentials(
    toWebauthnInstallCredentials(input.credentials),
    input.ordering ?? { kind: 'as-provided' },
  )
  return {
    kind: 'validator',
    address: input.address ?? WEBAUTHN_VALIDATOR_ADDRESS,
    initData: encodeAbiParameters(
      [
        { name: 'threshold', type: 'uint256' },
        {
          name: 'credentials',
          type: 'tuple[]',
          components: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
            { name: 'requireUV', type: 'bool' },
          ],
        },
      ],
      [BigInt(input.threshold), [...credentials]],
    ),
    deInitData: '0x',
    additionalContext: '0x',
  }
}

export function webauthnDefinitionCredentials(
  definition: AtomicValidatorDefinition,
): readonly WebauthnCredential[] {
  return definition.owners.map((owner) => {
    if (owner.kind !== 'webauthn') {
      throw new Error('WebAuthn validator contains a non-WebAuthn owner')
    }
    return {
      pubKey: owner.account.publicKey,
      authenticatorId: owner.account.id,
    }
  })
}

/**
 * The configuration `WebAuthnValidator.validateSignatureWithData` expects, which
 * is *not* the validator's install data: a verification context plus the account
 * the credential IDs were derived from. Multi-factor stores this blob verbatim
 * and hands it back on every factor validation.
 *
 * Written for the deployed validator ({@link WEBAUTHN_VALIDATOR_ADDRESS}); a
 * future deployment that drops the account from credential-ID derivation would
 * need its own encoder.
 */
export function encodeWebauthnStatelessData(input: {
  readonly credentials: readonly WebauthnCredential[]
  readonly threshold: number
  readonly usePrecompile?: boolean
}): Hex {
  const credentials = orderWebauthnCredentials(
    toWebauthnInstallCredentials(input.credentials),
    { kind: 'credential-id', account: WEBAUTHN_STATELESS_ACCOUNT },
  )
  return encodeAbiParameters(
    [
      {
        name: 'context',
        type: 'tuple',
        components: [
          { name: 'usePrecompile', type: 'bool' },
          { name: 'threshold', type: 'uint256' },
          { name: 'credentialIds', type: 'bytes32[]' },
          {
            name: 'credentialData',
            type: 'tuple[]',
            components: [
              { name: 'pubKeyX', type: 'uint256' },
              { name: 'pubKeyY', type: 'uint256' },
              { name: 'requireUV', type: 'bool' },
            ],
          },
        ],
      },
      { name: 'account', type: 'address' },
    ],
    [
      {
        usePrecompile: input.usePrecompile ?? false,
        threshold: BigInt(input.threshold),
        credentialIds: credentials.map((credential) =>
          generateWebauthnCredentialId(
            credential.pubKeyX,
            credential.pubKeyY,
            WEBAUTHN_STATELESS_ACCOUNT,
          ),
        ),
        credentialData: [...credentials],
      },
      WEBAUTHN_STATELESS_ACCOUNT,
    ],
  )
}

// A passkey factor signs through the sub-validator's stateless path: the
// assertions alone, paired with credentials derived from the pinned account.
export function webauthnStatelessCodecContext(
  definition: AtomicValidatorDefinition,
) {
  return {
    account: WEBAUTHN_STATELESS_ACCOUNT,
    usePrecompile: false,
    format: 'stateless' as const,
    credentials: definition.owners.flatMap((owner) =>
      owner.kind === 'webauthn'
        ? [{ ownerId: owner.id, publicKey: owner.account.publicKey }]
        : [],
    ),
  }
}

export function resolveWebauthnStatelessData(
  definition: AtomicValidatorDefinition,
): Hex {
  return encodeWebauthnStatelessData({
    credentials: webauthnDefinitionCredentials(definition),
    threshold: definition.threshold,
  })
}

export function resolveWebauthnValidator(
  definition: AtomicValidatorDefinition,
  ordering?: WebauthnCredentialOrdering,
): ResolvedModule {
  return resolveWebauthnCredentials({
    credentials: webauthnDefinitionCredentials(definition),
    threshold: definition.threshold,
    address:
      definition.module.source === 'explicit'
        ? definition.module.address
        : WEBAUTHN_VALIDATOR_ADDRESS,
    ...(ordering ? { ordering } : {}),
  })
}
