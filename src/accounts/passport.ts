import type { Account, Address, Hex } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  padHex,
} from 'viem'
import type { Module } from '../modules/common'
import type { RhinestoneAccountConfig } from '../types'
import type { ValidatorConfig } from './utils'

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

function getInstallData(module: Module) {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'installModule',
        inputs: [
          {
            type: 'uint256',
            name: 'moduleTypeId',
          },
          {
            type: 'address',
            name: 'module',
          },
          {
            type: 'bytes',
            name: 'initData',
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'installModule',
    args: [module.type, module.address, module.initData],
  })
}

export { getAddress, packSignature, getInstallData }
