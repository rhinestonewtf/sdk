import type { Address } from 'viem'
import type { Module } from '../modules/common'
import type { IntentOp, IntentOpElement, Op } from '../orchestrator/types'
import {
  prepareCompactInput,
  prepareENSInput,
  prepareOwnableInput,
  preparePermit2Input,
  prepareSingleChainGasRefundInput,
  prepareSingleChainLegacyInput,
  prepareWebAuthnInput,
  restoreModuleOutput,
  restoreTypedDataOutput,
} from './bridge'
import { getWasmConfig, getWasmInstance, loadWasm } from './loader'

// --- Validator Routers (synchronous — use cached WASM or fall back to TS) ---

export function routeOwnableValidator(
  threshold: number,
  owners: Address[],
  address: Address | undefined,
  tsFallback: (
    threshold: number,
    owners: Address[],
    address?: Address,
  ) => Module,
): Module {
  const config = getWasmConfig()
  if (!config.enabled) return tsFallback(threshold, owners, address)

  const wasm = getWasmInstance()
  if (!wasm) return tsFallback(threshold, owners, address)

  try {
    const input = prepareOwnableInput(threshold, owners, address)
    const result = wasm.get_ownable_validator(input)
    return restoreModuleOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_ownable_validator failed, using TS fallback:',
      err,
    )
    return tsFallback(threshold, owners, address)
  }
}

export function routeENSValidator(
  threshold: number,
  owners: Address[],
  ownerExpirations: number[],
  address: Address | undefined,
  tsFallback: (
    threshold: number,
    owners: Address[],
    ownerExpirations: number[],
    address?: Address,
  ) => Module,
): Module {
  const config = getWasmConfig()
  if (!config.enabled)
    return tsFallback(threshold, owners, ownerExpirations, address)

  const wasm = getWasmInstance()
  if (!wasm) return tsFallback(threshold, owners, ownerExpirations, address)

  try {
    const input = prepareENSInput(threshold, owners, ownerExpirations, address)
    const result = wasm.get_ens_validator(input)
    return restoreModuleOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_ens_validator failed, using TS fallback:',
      err,
    )
    return tsFallback(threshold, owners, ownerExpirations, address)
  }
}

export function routeWebAuthnValidator(
  threshold: number,
  credentials: { pubKeyX: string; pubKeyY: string }[],
  address: Address | undefined,
  tsFallback: (
    threshold: number,
    credentials: { pubKeyX: string; pubKeyY: string }[],
    address?: Address,
  ) => Module,
): Module {
  const config = getWasmConfig()
  if (!config.enabled) return tsFallback(threshold, credentials, address)

  const wasm = getWasmInstance()
  if (!wasm) return tsFallback(threshold, credentials, address)

  try {
    const input = prepareWebAuthnInput(threshold, credentials, address)
    const result = wasm.get_webauthn_validator(input)
    return restoreModuleOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_webauthn_validator failed, using TS fallback:',
      err,
    )
    return tsFallback(threshold, credentials, address)
  }
}

// --- Typed Data Routers (async — can trigger WASM load) ---

export async function routeCompactTypedData(
  intentOp: IntentOp,
  tsFallback: (intentOp: IntentOp) => unknown,
): Promise<unknown> {
  const config = getWasmConfig()
  if (!config.enabled) return tsFallback(intentOp)

  const wasm = getWasmInstance() ?? (await loadWasm())
  if (!wasm) return tsFallback(intentOp)

  try {
    const input = prepareCompactInput(intentOp)
    const result = wasm.get_compact_typed_data(input)
    return restoreTypedDataOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_compact_typed_data failed, using TS fallback:',
      err,
    )
    return tsFallback(intentOp)
  }
}

export async function routePermit2TypedData(
  element: IntentOpElement,
  nonce: bigint,
  expires: bigint,
  tsFallback: (
    element: IntentOpElement,
    nonce: bigint,
    expires: bigint,
  ) => unknown,
): Promise<unknown> {
  const config = getWasmConfig()
  if (!config.enabled) return tsFallback(element, nonce, expires)

  const wasm = getWasmInstance() ?? (await loadWasm())
  if (!wasm) return tsFallback(element, nonce, expires)

  try {
    const input = preparePermit2Input(element, nonce, expires)
    const result = wasm.get_permit2_typed_data(input)
    return restoreTypedDataOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_permit2_typed_data failed, using TS fallback:',
      err,
    )
    return tsFallback(element, nonce, expires)
  }
}

export async function routeSingleChainTypedDataLegacy(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: Op,
  nonce: bigint,
  tsFallback: (
    account: Address,
    intentExecutorAddress: Address,
    destinationChainId: string,
    destinationOps: Op,
    nonce: bigint,
  ) => unknown,
): Promise<unknown> {
  const config = getWasmConfig()
  if (!config.enabled)
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
    )

  const wasm = getWasmInstance() ?? (await loadWasm())
  if (!wasm)
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
    )

  try {
    const input = prepareSingleChainLegacyInput(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
    )
    const result = wasm.get_single_chain_typed_data_legacy(input)
    return restoreTypedDataOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_single_chain_typed_data_legacy failed, using TS fallback:',
      err,
    )
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
    )
  }
}

export async function routeSingleChainTypedDataWithGasRefund(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: Op,
  nonce: bigint,
  gasRefund: { token: Address; exchangeRate: bigint; overhead: bigint },
  tsFallback: (
    account: Address,
    intentExecutorAddress: Address,
    destinationChainId: string,
    destinationOps: Op,
    nonce: bigint,
    gasRefund: { token: Address; exchangeRate: bigint; overhead: bigint },
  ) => unknown,
): Promise<unknown> {
  const config = getWasmConfig()
  if (!config.enabled)
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
      gasRefund,
    )

  const wasm = getWasmInstance() ?? (await loadWasm())
  if (!wasm)
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
      gasRefund,
    )

  try {
    const input = prepareSingleChainGasRefundInput(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
      gasRefund,
    )
    const result = wasm.get_single_chain_typed_data_with_gas_refund(input)
    return restoreTypedDataOutput(result)
  } catch (err) {
    console.warn(
      '[rhinestone/wasm] get_single_chain_typed_data_with_gas_refund failed, using TS fallback:',
      err,
    )
    return tsFallback(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
      gasRefund,
    )
  }
}
