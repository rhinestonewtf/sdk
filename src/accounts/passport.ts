import type { Abi, Account, Address, Hex, PublicClient } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodePacked,
  getContractAddress,
  keccak256,
  padHex,
  toHex,
} from 'viem'
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  SmartAccount,
  SmartAccountImplementation,
  toSmartAccount,
} from 'viem/account-abstraction'
import {
  encodeSmartSessionSignature,
  getMockSignature,
} from '../modules/validators'
import {
  EnableSessionData,
  getPermissionId,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSION_MODE_USE,
} from '../modules/validators/smart-sessions'
import type { RhinestoneAccountConfig, Session } from '../types'
import { encode7579Calls, getAccountNonce, ValidatorConfig } from './utils'

const CREATION_CODE =
  '0x6054600f3d396034805130553df3fe63906111273d3560e01c14602b57363d3d373d3d3d3d369030545af43d82803e156027573d90f35b3d90fd5b30543d5260203df3'

const PASSPORT_FACTORY_ADDRESS: Address =
  '0xD70C6386Ca012CDeb249B4E46C53d3507D9CBB87'

const PASSPORT_MAIN_MODULE: Address =
  '0x0d1Bf2f4Ab334324665aeb8d481fF92CdE289439'

function getAddress(config: RhinestoneAccountConfig) {
  const owners = config.owners
  if (!owners) {
    throw new Error('Owners are required for passport')
  }
  if (owners.type !== 'ecdsa') {
    throw new Error('Only ecdsa owners are supported for passport')
  }
  const ownerAccounts = owners.accounts.map((owner) => ({
    weight: 1,
    account: owner,
  }))
  const salt = encodeImageHash(owners.threshold ?? 1, ownerAccounts)

  const accountInitData = padHex(PASSPORT_MAIN_MODULE, { size: 32 })
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: PASSPORT_FACTORY_ADDRESS,
    salt,
    bytecode: concat([CREATION_CODE, accountInitData]),
  })
  return address
}

async function packSignature(
  signature: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  const validatorAddress = validator.address
  const packedSig = encodePacked(
    ['address', 'bytes'],
    [validatorAddress, transformSignature(signature)],
  )
  return packedSig
}

async function getSessionSmartAccount(
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
      const dummyOpSignature = getMockSignature(session.owners)
      if (enableData) {
        return encodeSmartSessionSignature(
          SMART_SESSION_MODE_ENABLE,
          getPermissionId(session),
          dummyOpSignature,
          enableData,
        )
      }
      return encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        getPermissionId(session),
        dummyOpSignature,
      )
    },
    async (hash) => {
      const signature = await sign(hash)
      if (enableData) {
        return encodeSmartSessionSignature(
          SMART_SESSION_MODE_ENABLE,
          getPermissionId(session),
          signature,
          enableData,
        )
      }
      return encodeSmartSessionSignature(
        SMART_SESSION_MODE_USE,
        getPermissionId(session),
        signature,
      )
    },
  )
}

async function getBaseSmartAccount(
  address: Address,
  client: PublicClient,
  nonceValidatorAddress: Address,
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
    async getNonce(args) {
      const validatorAddress = nonceValidatorAddress
      const TIMESTAMP_ADJUSTMENT = 16777215n // max value for size 3
      const defaultedKey = (args?.key ?? 0n) % TIMESTAMP_ADJUSTMENT
      const defaultedValidationMode = '0x00'
      const key = concat([
        toHex(defaultedKey, { size: 3 }),
        defaultedValidationMode,
        validatorAddress,
      ])
      return getAccountNonce(client, {
        address,
        entryPointAddress: entryPoint07Address,
        key: BigInt(key),
      })
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
          signature: '0x' as Hex,
        },
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        chainId: chainId,
      })
      return await signUserOperation(hash)
    },
  })
}

function encodeImageHash(
  threshold: number,
  accounts: {
    weight: number
    account: Account
  }[],
) {
  const sorted = accounts.sort((a, b) =>
    a.account.address.toLowerCase() < b.account.address.toLowerCase() ? -1 : 1,
  )
  let imageHash = encodePacked(['uint256'], [BigInt(threshold)])

  for (const account of sorted) {
    imageHash = keccak256(
      encodeAbiParameters(
        [
          {
            type: 'bytes32',
          },
          {
            type: 'uint8',
          },
          {
            type: 'address',
          },
        ],
        [imageHash, account.weight, account.account.address],
      ),
    )
  }

  return imageHash
}

export { getAddress, packSignature, getSessionSmartAccount }
