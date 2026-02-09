import type { Address, Hex } from 'viem'
import { MODULE_TYPE_ID_VALIDATOR, type Module } from '../modules/common'
import type { IntentOp, IntentOpElement } from '../orchestrator/types'

/**
 * Prepare compact typed data input for WASM.
 * Mandate fields are spread through so new fields automatically reach WASM
 * without bridge changes. Qualifier's raw encodedVal is passed to WASM which
 * computes keccak256 internally — so qualifier hashing changes only need a WASM update.
 */
export function prepareCompactInput(intentOp: IntentOp) {
  return {
    sponsor: intentOp.sponsor,
    nonce: intentOp.nonce,
    expires: intentOp.expires,
    elements: intentOp.elements.map((element) => {
      const { qualifier, ...mandateRest } = element.mandate
      return {
        arbiter: element.arbiter,
        chainId: element.chainId,
        idsAndAmounts: element.idsAndAmounts,
        mandate: {
          ...mandateRest,
          qualifierEncodedVal: qualifier.encodedVal,
        },
      }
    }),
  }
}

/**
 * Prepare permit2 typed data input for WASM.
 * Mandate fields are spread through so new fields automatically reach WASM.
 */
export function preparePermit2Input(
  element: IntentOpElement,
  nonce: bigint,
  expires: bigint,
) {
  const { qualifier, ...mandateRest } = element.mandate
  return {
    element: {
      arbiter: element.arbiter,
      chainId: element.chainId,
      idsAndAmounts: element.idsAndAmounts,
      mandate: {
        ...mandateRest,
        qualifierEncodedVal: qualifier.encodedVal,
      },
    },
    nonce: nonce.toString(),
    expires: expires.toString(),
  }
}

/**
 * Prepare single chain legacy input for WASM.
 */
export function prepareSingleChainLegacyInput(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: unknown,
  nonce: bigint,
) {
  return {
    account,
    intentExecutorAddress,
    destinationChainId,
    destinationOps,
    nonce: nonce.toString(),
  }
}

/**
 * Prepare single chain with gas refund input for WASM.
 */
export function prepareSingleChainGasRefundInput(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: unknown,
  nonce: bigint,
  gasRefund: { token: Address; exchangeRate: bigint; overhead: bigint },
) {
  return {
    account,
    intentExecutorAddress,
    destinationChainId,
    destinationOps,
    nonce: nonce.toString(),
    gasRefund: {
      token: gasRefund.token,
      exchangeRate: gasRefund.exchangeRate.toString(),
      overhead: gasRefund.overhead.toString(),
    },
  }
}

/**
 * Prepare ownable validator input for WASM.
 */
export function prepareOwnableInput(
  threshold: number,
  owners: Address[],
  address?: Address,
) {
  return {
    threshold,
    owners: owners as string[],
    address: address as string | undefined,
  }
}

/**
 * Prepare ENS validator input for WASM.
 */
export function prepareENSInput(
  threshold: number,
  owners: Address[],
  ownerExpirations: number[],
  address?: Address,
) {
  return {
    threshold,
    owners: owners as string[],
    ownerExpirations,
    address: address as string | undefined,
  }
}

/**
 * Prepare WebAuthn validator input for WASM.
 */
export function prepareWebAuthnInput(
  threshold: number,
  credentials: { pubKeyX: string; pubKeyY: string }[],
  address?: Address,
) {
  return {
    threshold,
    credentials: credentials.map((c) => ({
      pubKeyX: c.pubKeyX,
      pubKeyY: c.pubKeyY,
    })),
    address: address as string | undefined,
  }
}

/**
 * Restore a WASM Module output to the TS Module type.
 */
export function restoreModuleOutput(wasmOutput: unknown): Module {
  const out = wasmOutput as {
    address: string
    initData: string
    deInitData: string
    additionalContext: string
    type: string
  }
  return {
    address: out.address as Address,
    initData: out.initData as Hex,
    deInitData: out.deInitData as Hex,
    additionalContext: out.additionalContext as Hex,
    type: MODULE_TYPE_ID_VALIDATOR,
  }
}

/**
 * Restore typed data output from WASM.
 * Converts string-encoded bigints in message fields back to BigInt where needed for viem.
 */
export function restoreTypedDataOutput(wasmOutput: unknown) {
  // The WASM returns typed data as a plain object with string values for bigints.
  // viem's hashTypedData needs actual BigInt values in the message.
  return deepRestoreBigInts(wasmOutput as Record<string, unknown>)
}

/**
 * Walk an object tree and convert numeric strings back to BigInt.
 * This is necessary because WASM serializes all large numbers as strings.
 */
function deepRestoreBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    // Only convert strings that look like decimal or hex numbers
    if (/^0x[0-9a-fA-F]+$/.test(obj) && obj.length > 42) {
      // Long hex strings are likely uint256 values, but not addresses (42 chars)
      return BigInt(obj)
    }
    if (/^\d+$/.test(obj) && obj.length > 0) {
      return BigInt(obj)
    }
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(deepRestoreBigInts)
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Don't convert domain.chainId or domain.verifyingContract
      if (
        key === 'chainId' ||
        key === 'verifyingContract' ||
        key === 'name' ||
        key === 'version'
      ) {
        result[key] = value
      } else {
        result[key] = deepRestoreBigInts(value)
      }
    }
    return result
  }
  return obj
}
