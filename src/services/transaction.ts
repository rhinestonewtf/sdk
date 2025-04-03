import { concat, encodePacked, Hex } from 'viem'
import {
  BundleResult,
  BundleStatus,
  getOrchestrator,
  getOrderBundleHash,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from '@rhinestone/orchestrator-sdk'
import { MetaIntent } from '@rhinestone/orchestrator-sdk'

import { getAddress, getDeployArgs, isDeployed, deploy } from './account'
import { getValidator } from './modules'
import {
  RhinestoneAccountConfig,
  Transaction,
  ValidatorSet,
  Validator,
} from '../types'

async function sendTransactions(
  config: RhinestoneAccountConfig,
  transaction: Transaction,
) {
  const isAccountDeployed = await isDeployed(transaction.sourceChain, config)
  if (!isAccountDeployed) {
    await deploy(config.deployerAccount, transaction.sourceChain, config)
  }

  const targetChain = transaction.targetChain
  const accountAddress = await getAddress(targetChain, config)
  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: transaction.tokenRequests.map((tokenRequest) => ({
      tokenAddress: tokenRequest.address,
      amount: tokenRequest.amount,
    })),
    targetAccount: accountAddress,
    targetExecutions: transaction.calls.map((call) => ({
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
  const bundleSignature = await sign(config.validators, orderBundleHash)
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

  const { factory, factoryData } = await getDeployArgs(targetChain, config)
  if (!factory || !factoryData) {
    throw new Error('Factory args not available')
  }
  const initCode = encodePacked(['address', 'bytes'], [factory, factoryData])

  const bundleResults: PostOrderBundleResult =
    await orchestrator.postSignedOrderBundle([
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
    bundleResult.status === BundleStatus.PENDING
  ) {
    const orchestrator = getOrchestrator(config.rhinestoneApiKey)
    bundleResult = await orchestrator.getBundleStatus(id)
  }
  if (bundleResult.status === BundleStatus.FAILED) {
    throw new Error('Bundle failed')
  }
  return bundleResult
}

async function sign(validators: ValidatorSet, hash: Hex) {
  if (Array.isArray(validators)) {
    const signatures = await Promise.all(
      validators.map((validator) => signSingle(validator, hash)),
    )
    return concat(signatures)
  } else {
    return await signSingle(validators, hash)
  }
}

async function signSingle(validator: Validator, hash: Hex) {
  switch (validator.type) {
    case 'ecdsa': {
      const sign = validator.account.signMessage
      if (!sign) {
        throw new Error('Signing not supported for the account')
      }
      return await sign({ message: { raw: hash } })
    }
    case 'passkey': {
      const sign = validator.account.signMessage
      if (!sign) {
        throw new Error('Signing not supported for the account')
      }
      const { signature } = await sign({ message: { raw: hash } })
      return signature
    }
  }
}

export { sendTransactions, waitForExecution }
