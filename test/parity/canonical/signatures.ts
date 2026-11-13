import type { IdentityRecord, SignerRecord } from '../context'
import { asRecord } from './common'

// Signatures and digests differ on every quote. Replacing each recorded signer
// output and digest with a role placeholder leaves only the bytes a build adds
// around them (validator prefixes, wrapping, v adjustments) to compare.

interface Replacement {
  needle: string
  placeholder: string
}

interface Templater {
  roleKeys: Map<SignerRecord, string>
  template(hex: string): string
}

const HEX = /^0x[0-9a-fA-F]*$/

function roleKeysFor(records: SignerRecord[]): Map<SignerRecord, string> {
  const counts = new Map<string, number>()
  const keys = new Map<SignerRecord, string>()
  for (const record of records) {
    const payload = asRecord(record.payload)
    const base =
      record.method === 'signTypedData'
        ? `${payload.primaryType}@${asRecord(payload.domain).chainId ?? '-'}`
        : record.method
    const k = counts.get(base) ?? 0
    counts.set(base, k + 1)
    keys.set(record, `${base}#${k}`)
  }
  return keys
}

function hexStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && HEX.test(value) && value.length > 2)
    out.push(value)
  else if (Array.isArray(value)) for (const item of value) hexStrings(item, out)
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) hexStrings(item, out)
  }
  return out
}

function signatureParts(hex: string, roleKey: string): Replacement[] {
  const body = hex.slice(2).toLowerCase()
  const parts: Replacement[] = [
    { needle: body, placeholder: `<sig:${roleKey}>` },
  ]
  // 65-byte ECDSA (r ‖ s ‖ v) and 64-byte P-256 (r ‖ s) signatures.
  if (body.length === 130 || body.length === 128) {
    const r = `<sig:${roleKey}.r>`
    const s = `<sig:${roleKey}.s>`
    parts.push({ needle: body.slice(0, 64), placeholder: r })
    parts.push({ needle: body.slice(64, 128), placeholder: s })
    // Owners signing a raw hash shift v by 4 so validators apply the
    // eth_sign prefix; v itself is a per-signature recovery bit.
    const v = Number.parseInt(body.slice(128), 16)
    if (v === 27 || v === 28) {
      parts.push({
        needle: body.slice(0, 128) + (v + 4).toString(16),
        placeholder: `${r}${s}<sig:${roleKey}.v+4>`,
      })
    }
  }
  return parts
}

// The raw hash an owner signs for message-signing accounts commits to the
// per-quote intent, like a typed-data digest.
function rawHash(record: SignerRecord): string | undefined {
  if (record.method !== 'signMessage') return undefined
  const raw = asRecord(asRecord(record.payload).message).raw
  return typeof raw === 'string' && /^0x[0-9a-fA-F]{64}$/.test(raw)
    ? raw
    : undefined
}

// A WebAuthn assertion embeds the signed hash, base64url-encoded, in its
// clientDataJSON; the rest of the JSON stays compared.
function webauthnChallenge(output: unknown): string | undefined {
  const json = asRecord(asRecord(output).webauthn).clientDataJSON
  if (typeof json !== 'string') return undefined
  try {
    const challenge = JSON.parse(json).challenge
    return typeof challenge === 'string' && challenge.length > 0
      ? Buffer.from(challenge, 'utf8').toString('hex')
      : undefined
  } catch {
    return undefined
  }
}

function createTemplater(
  records: SignerRecord[],
  identities: readonly IdentityRecord[] = [],
): Templater {
  const roleKeys = roleKeysFor(records)
  const replacements: Replacement[] = []
  // Applied before signer outputs, so a fresh signer's signature is named by
  // its identity rather than by role.
  const first: Replacement[] = identities
    .map(({ label, value }) => ({
      needle: value.replace(/^0x/i, '').toLowerCase(),
      placeholder: `<id:${label}>`,
    }))
    .filter(({ needle }) => needle.length >= 40)
    .sort((a, b) => b.needle.length - a.needle.length)
  for (const record of records) {
    const roleKey = roleKeys.get(record) as string
    const output = record.output
    const outputHex =
      typeof output === 'string'
        ? [output]
        : hexStrings(asRecord(output).signature ?? output)
    for (const hex of outputHex) {
      if (hex.length >= 66) replacements.push(...signatureParts(hex, roleKey))
    }
    if (record.digest) {
      replacements.push({
        needle: record.digest.slice(2).toLowerCase(),
        placeholder: `<digest:${roleKey}>`,
      })
    }
    const challenge = webauthnChallenge(output)
    if (challenge) {
      replacements.push({
        needle: challenge,
        placeholder: `<challenge:${roleKey}>`,
      })
    }
    const raw = rawHash(record)
    if (raw) {
      replacements.push({
        needle: raw.slice(2).toLowerCase(),
        placeholder: `<raw:${roleKey}>`,
      })
    }
  }
  // Longest first, so a full signature wins over its r and s halves.
  replacements.sort((a, b) => b.needle.length - a.needle.length)

  function template(hex: string): string {
    if (!HEX.test(hex)) return hex
    let result = hex.toLowerCase()
    for (const { needle, placeholder } of [...first, ...replacements]) {
      if (needle.length === 0) continue
      result = result.split(needle).join(placeholder)
    }
    return result
  }

  return { roleKeys, template }
}

function hexByteLength(hex: string): number {
  return (hex.length - 2) / 2
}

// Replaces every hex string in `value` with its template.
function templateDeep(value: unknown, templater: Templater): unknown {
  if (typeof value === 'string')
    return HEX.test(value) ? templater.template(value) : value
  if (Array.isArray(value))
    return value.map((item) => templateDeep(item, templater))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      out[key] = templateDeep(item, templater)
    return out
  }
  return value
}

// Like templateDeep, but each hex leaf also reports its byte length.
function templateSignatures(value: unknown, templater: Templater): unknown {
  if (typeof value === 'string' && HEX.test(value)) {
    return {
      byteLength: hexByteLength(value),
      template: templater.template(value),
    }
  }
  if (Array.isArray(value))
    return value.map((item) => templateSignatures(item, templater))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      out[key] = templateSignatures(item, templater)
    return out
  }
  return value
}

// Signatures by a fresh per-side signer become identities too: the whole
// signature, and r and s on their own.
function signerIdentities(
  identities: readonly IdentityRecord[],
  records: readonly SignerRecord[],
): IdentityRecord[] {
  const labels = new Set(
    identities.filter((entry) => entry.signer).map((entry) => entry.label),
  )
  const out: IdentityRecord[] = []
  const counts = new Map<string, number>()
  for (const record of records) {
    if (!labels.has(record.signer)) continue
    const k = counts.get(record.signer) ?? 0
    counts.set(record.signer, k + 1)
    const base = `${record.signer}.sig#${k}`
    const output = record.output
    const hexes =
      typeof output === 'string'
        ? [output]
        : Object.entries(asRecord(output))
            .filter(([key]) => key === 'r' || key === 's')
            .map(([, value]) => value)
    for (const hex of hexes) {
      if (typeof hex !== 'string' || !HEX.test(hex)) continue
      const body = hex.slice(2).toLowerCase()
      if (body.length === 130) {
        out.push({ label: base, value: body })
        out.push({ label: `${base}.r`, value: body.slice(0, 64) })
        out.push({ label: `${base}.s`, value: body.slice(64, 128) })
      } else if (body.length === 64) {
        out.push({
          label: `${base}.${hex === asRecord(output).r ? 'r' : 's'}`,
          value: body,
        })
      }
    }
  }
  return out
}

const PLACEHOLDER_HEX = /^0x(<id:[^>]+>)+$/

// Replaces each registered identity (a fresh account address, salt or
// signature per build) with `<id:label>` in every 0x-string and 0x-key,
// including strings already partly templated. The recovery bit of a templated
// (r, s) pair is per-signature randomness and is templated with it.
function templateIdentities(
  value: unknown,
  identities: readonly IdentityRecord[],
): unknown {
  if (identities.length === 0) return value
  const patterns = identities
    .map(({ label, value: hex }) => ({
      needle: hex.replace(/^0x/i, '').toLowerCase(),
      placeholder: `<id:${label}>`,
    }))
    .filter(({ needle }) => /^[0-9a-f]+$/.test(needle) && needle.length >= 40)
    .sort((a, b) => b.needle.length - a.needle.length)
    .map(({ needle, placeholder }) => ({
      pattern: new RegExp(needle, 'gi'),
      placeholder,
    }))
  const replace = (text: string): string => {
    if (!text.startsWith('0x')) return text
    let result = text
    for (const { pattern, placeholder } of patterns)
      result = result.replace(pattern, placeholder)
    return result
  }
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return replace(node)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(node))
        out[replace(key)] = walk(item)
      if (
        typeof out.r === 'string' &&
        typeof out.s === 'string' &&
        PLACEHOLDER_HEX.test(out.r) &&
        PLACEHOLDER_HEX.test(out.s)
      ) {
        for (const key of ['v', 'yParity'])
          if (key in out) out[key] = '<id:recovery>'
      }
      return out
    }
    return node
  }
  return walk(value)
}

export type { Templater }
export {
  createTemplater,
  roleKeysFor,
  templateDeep,
  signerIdentities,
  templateIdentities,
  templateSignatures,
}
