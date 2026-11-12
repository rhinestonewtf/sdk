import type { SignerRecord } from '../context'
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
    parts.push({ needle: body.slice(0, 64), placeholder: `<sig:${roleKey}.r>` })
    parts.push({
      needle: body.slice(64, 128),
      placeholder: `<sig:${roleKey}.s>`,
    })
  }
  return parts
}

function createTemplater(records: SignerRecord[]): Templater {
  const roleKeys = roleKeysFor(records)
  const replacements: Replacement[] = []
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
  }
  // Longest first, so a full signature wins over its r and s halves.
  replacements.sort((a, b) => b.needle.length - a.needle.length)

  function template(hex: string): string {
    if (!HEX.test(hex)) return hex
    let result = hex.toLowerCase()
    for (const { needle, placeholder } of replacements) {
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

export type { Templater }
export { createTemplater, roleKeysFor, templateDeep, templateSignatures }
