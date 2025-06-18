import type { Address, PublicClient, Hex } from "viem"

import {
  installModule,
  type Execution
} from "@rhinestone/module-sdk"  // TODO: You might want to implement this locally

import type { RhinestoneAccountConfig, Transaction } from "../../types.js"
import { getAddress as getAddressInternal } from "../../accounts/index.js"
import { sendTransaction as sendTransactionInternal } from "../../execution/index.js"
import { getWebAuthnValidator } from "./core.js"

// Define ChainId type locally to avoid import issues
type ChainId = number

interface PublicKey {
  prefix?: number | undefined
  x: bigint
  y: bigint
}

interface WebAuthnCredential {
  pubKey: PublicKey | Hex | Uint8Array
  authenticatorId: string
  hook?: Address
}

/**
 * Add a WebAuthn validator to the account
 * @param config Rhinestone account config
 * @param webAuthnCredential WebAuthn credential containing public key and authenticator ID
 * @param chainId The chain ID to operate on
 * @param publicClient Optional public client for the specified chain
 * @returns Transaction result object
 */
export async function addWebAuthnValidator(
  config: RhinestoneAccountConfig,
  webAuthnCredential: WebAuthnCredential,
  chainId: ChainId,
  publicClient?: PublicClient
) {
  const address = await getAddressInternal(config) as Address


  // Create the WebAuthn validator module using Rhinestone SDK
  const webAuthnValidator = getWebAuthnValidator({
    pubKey: webAuthnCredential.pubKey,
    authenticatorId: webAuthnCredential.authenticatorId,
    hook: webAuthnCredential.hook,
  })

  // Get the executions required to install the module
  const executions = await installModule({
    publicClient,
    account: { type: config.account?.type || "safe", address, deployedOnChains: [chainId] },
    module: webAuthnValidator,
  })

  // Convert executions to our Transaction format
  const transaction: Transaction = {
    chain: publicClient.chain,
    calls: executions.map((execution: Execution) => ({
      to: execution.target,
      data: execution.callData,
      value: (execution.value as bigint) || 0n,
    })),
    tokenRequests: [],
  }

  return sendTransactionInternal(config, transaction)
} 