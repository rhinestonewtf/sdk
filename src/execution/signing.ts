/**
 * Multi-chain intent signing utilities.
 *
 * These functions sign EIP-712 typed data for intent operations across
 * multiple chains using a direct EOA signer. The WASM mapper builds
 * the correct typed data (compact, permit2, or single-chain) based on
 * the intentOp's settlement context — the caller doesn't need to know
 * which settlement type is being used.
 */
import type { Hex } from 'viem'
import type {
  BatchSigningResult,
  MultiChainSigningConfig,
  MultiChainSigningResult,
} from './types'
import { getIntentMessagesFromWasm } from './wasm/loader'

async function signConfig(
  config: MultiChainSigningConfig,
): Promise<MultiChainSigningResult> {
  if (!config.eoaAccount.signTypedData) {
    throw new Error('EOA account does not support typed data signing')
  }

  const { origin } = await getIntentMessagesFromWasm(
    {
      intentOp: config.intentOp,
      context: {
        accountAddress: config.eoaAccount.address,
      },
    },
    config.wasmUrl,
  )

  const originSignatures: Hex[] = []
  for (const typedData of origin) {
    const sig = await config.eoaAccount.signTypedData(typedData)
    originSignatures.push(sig)
  }

  return {
    chainId: config.chain.id,
    originSignatures,
    destinationSignature: originSignatures[0] ?? ('0x' as Hex),
    success: true,
  }
}

/**
 * Signs intent typed data for multiple chains concurrently.
 * Each config's intentOp is passed through the WASM mapper to get EIP-712
 * typed data, then signed with the EOA's `signTypedData`.
 * All chains are signed in parallel via `Promise.allSettled`.
 */
async function signIntentBatch(
  configs: MultiChainSigningConfig[],
): Promise<BatchSigningResult> {
  const settled = await Promise.allSettled(configs.map(signConfig))

  const results: MultiChainSigningResult[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    return {
      chainId: configs[i].chain.id,
      originSignatures: [] as Hex[],
      destinationSignature: '0x' as Hex,
      success: false as const,
      error:
        result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason)),
    }
  })

  const successfulSignatures = results.filter((r) => r.success).length

  return {
    results,
    totalChains: configs.length,
    successfulSignatures,
    failedSignatures: results.length - successfulSignatures,
    allSuccessful: successfulSignatures === configs.length,
  }
}

/**
 * Signs intent typed data for multiple chains one at a time.
 * Same as `signIntentBatch` but processes chains sequentially,
 * calling `onProgress` after each chain completes. Useful for
 * UIs that want to show per-chain signing progress.
 */
async function signIntentSequential(
  configs: MultiChainSigningConfig[],
  onProgress?: (
    completed: number,
    total: number,
    current: MultiChainSigningResult,
  ) => void,
): Promise<BatchSigningResult> {
  const results: MultiChainSigningResult[] = []

  for (const [i, config] of configs.entries()) {
    let result: MultiChainSigningResult
    try {
      result = await signConfig(config)
    } catch (error) {
      result = {
        chainId: config.chain.id,
        originSignatures: [],
        destinationSignature: '0x' as Hex,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
    results.push(result)
    onProgress?.(i + 1, configs.length, result)
  }

  const successfulSignatures = results.filter((r) => r.success).length

  return {
    results,
    totalChains: configs.length,
    successfulSignatures,
    failedSignatures: results.length - successfulSignatures,
    allSuccessful: successfulSignatures === configs.length,
  }
}

export { signIntentBatch, signIntentSequential }
