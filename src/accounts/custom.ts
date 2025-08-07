import { Address, PublicClient, Hex, Abi, concat } from 'viem'
import { SmartAccount, SmartAccountImplementation, entryPoint07Abi, entryPoint07Address, getUserOperationHash } from 'viem/account-abstraction'
import { toSmartAccount } from 'viem/account-abstraction'
import { encode7579Calls, getAccountNonce, ValidatorConfig } from "./utils"
import { EnableSessionData } from '../modules/validators/smart-sessions'
import { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import { Module } from '../modules/common'

function getDeployArgs(config: RhinestoneAccountConfig) {
  if (!config.account || !config.account.custom) {
    throw new Error('Account provider not found')
  }

  return config.account.custom.getDeployArgs()
}

function getInstallData(config: RhinestoneAccountConfig, module: Module): Hex[] {
  if (!config.account || !config.account.custom) {
    throw new Error('Account provider not found')
  }

  return config.account.custom.getInstallData(module);
}

function getAddress(config: RhinestoneAccountConfig): Address {
  if (!config.account || !config.account.custom) {
    throw new Error('Account provider not found')
  }

  return config.account.custom.getAddress()
}

async function getPackedSignature(
  config: RhinestoneAccountConfig,
  signFn: (message: Hex) => Promise<Hex>,
  hash: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  if (!config.account || !config.account.custom) {
    throw new Error('Account provider not found')
  }

  return config.account.custom.getPackedSignature(signFn, hash, validator, transformSignature)
}

async function getSessionSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  address: Address,
  session: Session,
  validatorAddress: Address,
  enableData: EnableSessionData | null,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return await getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      if (!config.account || !config.account.custom) {
        throw new Error('Account provider not found')
      }

      return config.account.custom.getSessionStubSignature(session, enableData)
    },
    async (hash) => {
      if (!config.account || !config.account.custom) {
        throw new Error('Account provider not found')
      }

      return config.account.custom.signSessionUserOperation(session, enableData, hash)
    },
  )
}

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  validatorAddress: Address,
  getStubSignature: () => Promise<Hex>,
  signUserOperation: (hash: Hex) => Promise<Hex>,
): Promise<SmartAccount<SmartAccountImplementation<Abi, '0.7'>>> {
  return await toSmartAccount({
    client,
    entryPoint: {
      abi: entryPoint07Abi,
      address: entryPoint07Address,
      version: '0.7',
    },
    async decodeCalls() {
      throw new Error('Not implemented')
    },
    async encodeCalls(calls) {
      return encode7579Calls({
        mode: {
          type: calls.length > 1 ? 'batchcall' : 'call',
          revertOnError: false,
          selector: '0x',
          context: '0x',
        },
        callData: calls,
      })
    },
    async getAddress() {
      return address
    },
    async getFactoryArgs() {
      return {}
    },
    async getNonce() {
      const key = concat([validatorAddress, '0x00000000'])
      const nonce = await getAccountNonce(client, {
        address,
        entryPointAddress: entryPoint07Address,
        key: BigInt(key),
      })
      return nonce
    },
    async getStubSignature() {
      return getStubSignature()
    },
    async signMessage() {
      throw new Error('Not implemented')
    },
    async signTypedData() {
      throw new Error('Not implemented')
    },
    async signUserOperation(parameters) {
      const { chainId = client.chain?.id, ...userOperation } = parameters

      if (!chainId) throw new Error('Chain id not found')

      const hash = getUserOperationHash({
        userOperation: {
          ...userOperation,
          sender: userOperation.sender ?? (await this.getAddress()),
          signature: '0x',
        },
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        chainId: chainId,
      })
      return await signUserOperation(hash)
    },
  })
}

async function getSmartAccount(
  config: RhinestoneAccountConfig,
  client: PublicClient,
  address: Address,
  owners: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getBaseSmartAccount(
    address,
    client,
    validatorAddress,
    async () => {
      if (!config.account || !config.account.custom) {
        throw new Error('Account provider not found')
      }

      return config.account.custom.getStubSignature()
    },
    sign,
  )
}

export {
  getDeployArgs,
  getInstallData,
  getAddress,
  getPackedSignature,
  getSessionSmartAccount,
  getBaseSmartAccount,
  getSmartAccount,
}