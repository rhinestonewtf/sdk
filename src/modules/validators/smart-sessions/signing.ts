import { domainSeparator, type TypedData, zeroHash } from 'viem'
import { FAR_FUTURE_MS } from '../permissions'
import { encodeErc7739ContentType } from './erc7739'
import type { ResolvedPolicyAddresses } from './policies/addresses'
import { encodeSessionPolicy } from './policies/encode'
import type {
  ResolvedERC7739Policies,
  SessionSigning,
  SessionSigningContent,
} from './types'

const UINT48_MAX = 2 ** 48 - 1
const DOMAIN_FIELDS = new Set([
  'name',
  'version',
  'chainId',
  'verifyingContract',
  'salt',
])
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u

export function resolveSessionSigning(input: {
  readonly signing?: SessionSigning
  readonly environment: 'production' | 'development'
  readonly addresses: ResolvedPolicyAddresses
}): ResolvedERC7739Policies {
  const signing = input.signing ?? { mode: 'unrestricted' }
  if (signing.mode === 'disabled') {
    if ('validAfter' in signing || 'validUntil' in signing) {
      throw new Error('Disabled session signing cannot have a validity window')
    }
    return { allowedERC7739Content: [], erc1271Policies: [] }
  }

  const allowedERC7739Content =
    signing.mode === 'unrestricted'
      ? [{ appDomainSeparator: zeroHash, contentNames: [''] }]
      : resolveAllowedContents(signing.allowedContents)

  return {
    allowedERC7739Content,
    erc1271Policies: [
      resolveSigningPolicy({
        validAfter: signing.validAfter,
        validUntil: signing.validUntil,
        environment: input.environment,
        addresses: input.addresses,
      }),
    ],
  }
}

function resolveAllowedContents(
  contents: readonly SessionSigningContent[],
): ResolvedERC7739Policies['allowedERC7739Content'] {
  if (contents.length === 0) {
    throw new Error(
      'Scoped session signing requires at least one allowed content',
    )
  }

  const byDomain = new Map<
    string,
    { appDomainSeparator: `0x${string}`; contentNames: string[] }
  >()
  const seen = new Set<string>()
  for (const content of contents) {
    validateContent(content)
    const appDomainSeparator = domainSeparator({ domain: content.domain })
    const contentName = encodeErc7739ContentType({
      primaryType: content.primaryType,
      types: content.types,
    })
    const duplicateKey = `${appDomainSeparator}:${contentName}`
    if (seen.has(duplicateKey)) {
      throw new Error(
        `Duplicate scoped signing content for ${content.primaryType} under domain ${appDomainSeparator}`,
      )
    }
    seen.add(duplicateKey)

    const group = byDomain.get(appDomainSeparator)
    if (group) group.contentNames.push(contentName)
    else {
      byDomain.set(appDomainSeparator, {
        appDomainSeparator,
        contentNames: [contentName],
      })
    }
  }
  return [...byDomain.values()]
}

function validateContent(content: SessionSigningContent): void {
  for (const field of Object.keys(content.domain)) {
    if (!DOMAIN_FIELDS.has(field)) {
      throw new Error(`Unsupported EIP-712 domain field "${field}"`)
    }
  }
  if (content.primaryType === 'EIP712Domain') {
    throw new Error('EIP712Domain cannot be a scoped signing primary type')
  }
  if (!content.types[content.primaryType]) {
    throw new Error(
      `Scoped signing primary type "${content.primaryType}" is missing from types`,
    )
  }
  validateTypeDependencies(content.primaryType, content.types)
}

function validateTypeDependencies(primaryType: string, types: TypedData): void {
  const visited = new Set<string>()
  const visit = (type: string): void => {
    const match = type.match(
      /^([A-Za-z_][A-Za-z0-9_]*)(\[(?:[1-9][0-9]*)?\])*$/u,
    )
    if (!match) {
      throw new Error(
        `Scoped signing type "${type}" is not a valid EIP-712 type`,
      )
    }
    const typeName = match[1]
    if (isPrimitiveType(typeName) || visited.has(typeName)) return
    const fields = types[typeName]
    if (!fields) {
      throw new Error(`Scoped signing type "${typeName}" is missing from types`)
    }
    visited.add(typeName)
    const fieldNames = new Set<string>()
    for (const field of fields) {
      if (!IDENTIFIER.test(field.name)) {
        throw new Error(
          `Scoped signing field name "${field.name}" in ${typeName} is invalid`,
        )
      }
      if (fieldNames.has(field.name)) {
        throw new Error(
          `Scoped signing type "${typeName}" has duplicate field "${field.name}"`,
        )
      }
      fieldNames.add(field.name)
      visit(field.type)
    }
  }
  visit(primaryType)
}

function isPrimitiveType(type: string): boolean {
  return (
    type === 'address' ||
    type === 'bool' ||
    type === 'string' ||
    type === 'bytes' ||
    /^bytes([1-9]|[12][0-9]|3[0-2])$/u.test(type) ||
    /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/u.test(
      type,
    )
  )
}

function resolveSigningPolicy(input: {
  readonly validAfter?: Date
  readonly validUntil?: Date
  readonly environment: 'production' | 'development'
  readonly addresses: ResolvedPolicyAddresses
}) {
  if (input.validAfter === undefined && input.validUntil === undefined) {
    return encodeSessionPolicy(
      { type: 'sudo' },
      input.environment,
      input.addresses,
    )
  }

  const validAfter = dateSeconds(input.validAfter ?? new Date(0), 'validAfter')
  const validUntil = dateSeconds(
    input.validUntil ?? new Date(FAR_FUTURE_MS),
    'validUntil',
  )
  if (validUntil < validAfter) {
    throw new Error('Session signing validUntil is before validAfter')
  }
  return encodeSessionPolicy(
    {
      type: 'time-frame',
      validAfter: validAfter * 1000,
      validUntil: validUntil * 1000,
    },
    input.environment,
    input.addresses,
  )
}

function dateSeconds(date: Date, field: string): number {
  const milliseconds = date.getTime()
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Session signing ${field} must be a valid Date`)
  }
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 0 || seconds > UINT48_MAX) {
    throw new Error(`Session signing ${field} is outside the uint48 range`)
  }
  return seconds
}
