import { Account, Chain, concat, encodePacked, Hex } from 'viem'
import { WebAuthnAccount } from 'viem/account-abstraction'

import {
  type BundleResult,
  type MetaIntent,
  type SignedMultiChainCompact,
  BUNDLE_STATUS_PENDING,
  BUNDLE_STATUS_FAILED,
  getOrchestrator,
  getOrderBundleHash,
  BUNDLE_STATUS_PARTIALLY_COMPLETED,
} from '../orchestrator'
import {
  getAddress,
  isDeployed,
  deploySource,
  deployTarget,
  getBundleInitCode,
} from '../accounts'
import {
  getValidator,
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../modules'
import { RhinestoneAccountConfig, Transaction, OwnerSet } from '../types'

const POLLING_INTERVAL = 500

async function sendTransactions(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
) {
  const { sourceChain, targetChain, calls, tokenRequests } = transaction
  const isAccountDeployed = await isDeployed(sourceChain, config)
  if (!isAccountDeployed) {
    await deploySource(config.deployerAccount, sourceChain, config)
  }

  const accountAddress = await getAddress(config)
  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: tokenRequests.map((tokenRequest) => ({
      tokenAddress: tokenRequest.address,
      amount: tokenRequest.amount,
    })),
    targetAccount: accountAddress,
    targetExecutions: calls.map((call) => ({
      value: call.value ?? 0n,
      to: call.to,
      data: call.data ?? '0x',
    })),
  }

  const orchestrator = getOrchestrator(config.rhinestoneApiKey)
  const orderPath = await orchestrator.getOrderPath(metaIntent, accountAddress)
  orderPath[0].orderBundle.segments[0].witness.execs = [
    ...orderPath[0].injectedExecutions,
    ...metaIntent.targetExecutions,
  ]

  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle)
  const bundleSignature = await sign(
    config.owners,
    sourceChain,
    orderBundleHash,
  )
  const validatorModule = getValidator(config)
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [validatorModule.address, bundleSignature],
  )

  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      packedSig,
    ),
    targetSignature: packedSig,
  }

  await deployTarget(targetChain, config)
  const initCode = await getBundleInitCode(config)
  const bundleResults = await orchestrator.postSignedOrderBundle([
    {
      signedOrderBundle,
      initCode,
    },
  ])

  return bundleResults[0].bundleId
}

async function waitForExecution(config: RhinestoneAccountConfig, id: bigint) {
  let bundleResult: BundleResult | null = null
  while (
    bundleResult === null ||
    bundleResult.status === BUNDLE_STATUS_PENDING ||
    bundleResult.status === BUNDLE_STATUS_PARTIALLY_COMPLETED
  ) {
    const orchestrator = getOrchestrator(config.rhinestoneApiKey)
    bundleResult = await orchestrator.getBundleStatus(id)
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
  }
  if (bundleResult.status === BUNDLE_STATUS_FAILED) {
    throw new Error('Bundle failed')
  }
  return bundleResult
}

async function sign(validators: OwnerSet, chain: Chain, hash: Hex) {
  switch (validators.type) {
    case 'ecdsa': {
      const signatures = await Promise.all(
        validators.accounts.map((account) => signEcdsa(account, hash)),
      )
      return concat(signatures)
    }
    case 'passkey': {
      return await signPasskey(validators.account, chain, hash)
    }
  }
}

async function signEcdsa(account: Account, hash: Hex) {
  if (!account.signMessage) {
    throw new Error('Signing not supported for the account')
  }
  return await account.signMessage({ message: { raw: hash } })
}

async function signPasskey(account: WebAuthnAccount, chain: Chain, hash: Hex) {
  const { webauthn, signature } = await account.sign({ hash })
  const usePrecompiled = isRip7212SupportedNetwork(chain)
  const encodedSignature = getWebauthnValidatorSignature({
    webauthn,
    signature,
    usePrecompiled,
  })
  return encodedSignature
}

export { sendTransactions, waitForExecution }
