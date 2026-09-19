import type { Hex } from 'viem'
import type { SigningProof } from '../../../src/clients/orchestrator/public'
import {
  SIG_MODE_EMISSARY_EXECUTION_ERC1271,
  SIG_MODE_ERC1271,
} from '../../../src/clients/orchestrator/public'
import type {
  PreparedTransactionData,
  SignedTransactionData,
} from '../../../src/index'

export function readSignatureMode(
  prepared: PreparedTransactionData,
): number | undefined {
  return prepared.intentInput.options.signatureMode
}

// Single hex => ERC-1271 path; { preClaim, notarizedClaim } => the dual
// emissary+1271 path used by sessions with verifyExecutions.
export type OriginSignatureShape = 'single' | 'dual'

type Eip712Proof = Extract<SigningProof, { kind: 'eip712' }>

function eip712Proofs(signed: SignedTransactionData): Eip712Proof[] {
  return signed.proofs.filter(
    (proof): proof is Eip712Proof => proof.kind === 'eip712',
  )
}

function isDual(
  signature: Eip712Proof['signature'],
): signature is { preClaim: Hex; notarizedClaim: Hex } {
  return typeof signature === 'object' && signature !== null
}

export function classifyOriginSignature(
  proof: Eip712Proof,
): OriginSignatureShape {
  return isDual(proof.signature) ? 'dual' : 'single'
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

// Asserts every claim proof has the same shape, and that the shape matches the
// prepared signatureMode (mode/bytes consistency — the PR #476 invariant).
export function expectOriginSignatures(
  signed: SignedTransactionData,
  expected: OriginSignatureShape,
): void {
  const proofs = eip712Proofs(signed).filter(
    (_proof, index) =>
      signed.quote.signingRequests[index]?.purpose === 'originAuthorization',
  )
  if (proofs.length === 0) {
    throw new Error(
      'Expected at least one origin authorization proof, got none',
    )
  }
  for (const [index, proof] of proofs.entries()) {
    const shape = classifyOriginSignature(proof)
    if (shape !== expected) {
      throw new Error(
        `Expected origin proof #${index} to be ${expected}, got ${shape}`,
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
  const first = eip712Proofs(signed)[0]
  if (!first) throw new Error('Expected at least one EIP-712 proof')
  const shape = classifyOriginSignature(first)
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
// preClaim signature ends in the validator's ECDSA signature, so corrupting the
// last 65 bytes guarantees on-chain verifyExecution fails.
export function corruptTail(hex: Hex, bytes: number): Hex {
  const tailHex = 'ff'.repeat(bytes)
  return `${hex.slice(0, hex.length - tailHex.length)}${tailHex}` as Hex
}

// Tampers with the execution-signature bytes of a signed intent so the
// orchestrator's simulation must reject it. Proof ORDER is preserved: the
// vector still answers the same requests, it just answers them wrongly.
export function tamperExecutionSignatures(
  signed: SignedTransactionData,
): SignedTransactionData {
  return {
    ...signed,
    proofs: signed.proofs.map((proof) => {
      if (proof.kind !== 'eip712') return proof
      return {
        ...proof,
        signature: isDual(proof.signature)
          ? {
              ...proof.signature,
              preClaim: corruptTail(proof.signature.preClaim, 65),
            }
          : corruptTail(proof.signature, 65),
      }
    }),
  }
}
