import type { Hex } from 'viem'
import type {
  PreparedTransactionData,
  SignedTransactionData,
} from '../../../src/index'
import type { OriginSignature } from '../../../src/orchestrator/types'
import {
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
} from '../../../src/orchestrator/types'

// `signatureMode` lives on the prepared intent input, which the public type
// keeps as `unknown`. Read it through a narrow cast rather than widening the
// SDK type — tests assert on it, they don't depend on it being public.
export function readSignatureMode(
  prepared: PreparedTransactionData,
): number | undefined {
  const input = prepared.intentInput as
    | { options?: { signatureMode?: number } }
    | undefined
  return input?.options?.signatureMode
}

// Single hex => ERC-1271 path; { preClaimSig, notarizedClaimSig } => the dual
// emissary+1271 path used by sessions with verifyExecutions.
export type OriginSignatureShape = 'single' | 'dual'

function isDual(signature: OriginSignature): signature is {
  notarizedClaimSig: `0x${string}`
  preClaimSig: `0x${string}`
} {
  return typeof signature === 'object' && signature !== null
}

export function classifyOriginSignature(
  signature: OriginSignature,
): OriginSignatureShape {
  return isDual(signature) ? 'dual' : 'single'
}

export function expectSignatureMode(
  prepared: PreparedTransactionData,
  expected: number,
): void {
  const actual = readSignatureMode(prepared)
  if (actual !== expected) {
    throw new Error(`Expected signatureMode ${expected}, got ${String(actual)}`)
  }
}

// Asserts every origin signature has the same shape, and that the shape matches
// the prepared signatureMode (mode/bytes consistency — the PR #476 invariant).
export function expectOriginSignatures(
  signed: SignedTransactionData,
  expected: OriginSignatureShape,
): void {
  const signatures = signed.originSignatures
  if (signatures.length === 0) {
    throw new Error('Expected at least one origin signature, got none')
  }
  for (const [index, signature] of signatures.entries()) {
    const shape = classifyOriginSignature(signature)
    if (shape !== expected) {
      throw new Error(
        `Expected origin signature #${index} to be ${expected}, got ${shape}`,
      )
    }
  }
}

// The core encoding invariant: the top-level signatureMode the SDK tells the
// orchestrator must match the shape of the signature bytes it actually emitted.
// A single hex signature implies the ERC-1271 path; a dual sig implies the
// hybrid emissary-execution path. A mismatch (e.g. mode 0 with single 1271
// bytes) makes the on-chain dispatcher pick the wrong validator.
export function expectModeMatchesBytes(
  prepared: PreparedTransactionData,
  signed: SignedTransactionData,
): void {
  const mode = readSignatureMode(prepared)
  const shape = classifyOriginSignature(signed.originSignatures[0])
  const impliedMode =
    shape === 'dual' ? SIG_MODE_EMISSARY_EXECUTION_ERC1271 : SIG_MODE_ERC1271
  expectOriginSignatures(signed, shape)
  if (mode !== impliedMode) {
    throw new Error(
      `signatureMode ${String(mode)} does not match ${shape} signature bytes ` +
        `(which imply mode ${impliedMode})`,
    )
  }
}

// Overwrite the trailing `bytes` of a hex signature with 0xff. The emissary
// preClaimSig ends in the validator's ECDSA signature, so corrupting the last
// 65 bytes guarantees on-chain verifyExecution fails.
export function corruptTail(hex: Hex, bytes: number): Hex {
  const tailHex = 'ff'.repeat(bytes)
  return `${hex.slice(0, hex.length - tailHex.length)}${tailHex}` as Hex
}

// Tampers with the execution-signature bytes of a signed (dual-sig) intent so
// the orchestrator's simulation must reject it.
export function tamperExecutionSignatures(
  signed: SignedTransactionData,
): SignedTransactionData {
  return {
    ...signed,
    originSignatures: signed.originSignatures.map((signature) =>
      isDual(signature)
        ? { ...signature, preClaimSig: corruptTail(signature.preClaimSig, 65) }
        : corruptTail(signature, 65),
    ),
    destinationSignature: corruptTail(signed.destinationSignature, 65),
  }
}
