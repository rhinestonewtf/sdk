import type { Account, Address, Chain, Hex, PublicClient } from 'viem'
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  hashMessage,
  keccak256,
  padHex,
  parseAbi,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { getSetup as getModuleSetup, getOwners } from '../modules'
import type { Module } from '../modules/common'
import type { EnableSessionData } from '../modules/validators/smart-sessions'
import type { OwnerSet, RhinestoneAccountConfig, Session } from '../types'
import {
  getGuardianSmartAccount as getNexusGuardianSmartAccount,
  getInstallData as getNexusInstallData,
  getSessionSmartAccount as getNexusSessionSmartAccount,
  getSmartAccount as getNexusSmartAccount,
  packSignature as packNexusSignature,
} from './nexus'
import type { ValidatorConfig } from './utils'

const CREATION_CODE =
  '0x6054600f3d396034805130553df3fe63906111273d3560e01c14602b57363d3d373d3d3d3d369030545af43d82803e156027573d90f35b3d90fd5b30543d5260203df3'

const PASSPORT_IMPLEMENTATION_ADDRESS: Address =
  '0xd3d2ab942c97c2a59f7466f797742a51fefd3121'
const PASSPORT_FACTORY_ADDRESS: Address =
  '0xD70C6386Ca012CDeb249B4E46C53d3507D9CBB87'
const NEXUS_BOOTSTRAP_ADDRESS: Address =
  '0x9bdcdb6ffc23dd8001416e5097b693d0b83d3ff1'

interface Transaction {
  delegateCall: boolean
  revertOnError: boolean
  gasLimit: bigint
  target: Address
  value: bigint
  data: Hex
}

interface WalletDeploymentConfig {
  owners: {
    weight: number
    account: Account
  }[]
  threshold: number
}

const compareAddr = (
  a: Address | { address: Address },
  b: Address | { address: Address },
) => {
  const addrA = typeof a === 'string' ? a : a.address
  const addrB = typeof b === 'string' ? b : b.address
  return addrA.toLowerCase() < addrB.toLowerCase() ? -1 : 1
}

function encodeImageHash(
  threshold: number,
  accounts: {
    weight: number
    account: Account
  }[],
) {
  const sorted = accounts.sort((a, b) =>
    compareAddr(a.account.address, b.account.address),
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

async function signOwner(
  cfa: Address,
  walletNonce: bigint,
  transactions: Transaction[],
  chain: Chain,
  walletConfig: WalletDeploymentConfig,
) {
  function encodeMetaTransactionsData(
    owner: string,
    txs: Transaction[],
    networkId: bigint,
    nonce: bigint,
  ): Hex {
    const transactions = encodeAbiParameters(
      [
        { type: 'uint256' },
        {
          type: 'tuple[]',
          components: [
            { type: 'bool', name: 'delegateCall' },
            { type: 'bool', name: 'revertOnError' },
            { type: 'uint256', name: 'gasLimit' },
            { type: 'address', name: 'target' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
          ],
        },
      ],
      [nonce, txs],
    )
    return encodeMessageData(owner, transactions, networkId)
  }

  function encodeMessageData(
    owner: string,
    message: Hex,
    networkId: bigint,
  ): Hex {
    return encodeMessageSubDigest(owner, keccak256(message), networkId)
  }

  function encodeMessageSubDigest(
    owner: string,
    digest: Hex,
    networkId: bigint,
  ): Hex {
    return encodePacked(
      ['string', 'uint256', 'address', 'bytes32'],
      ['\x19\x01', networkId, owner as Address, digest],
    )
  }

  async function ethSign(
    account: Account,
    message: Hex,
    hashed = false,
  ): Promise<Hex> {
    console.log('user', account.address)
    const hash = hashed ? message : keccak256(message)
    console.log('user hash', hash)
    if (!account.signMessage) {
      throw new Error('Account does not support signMessage')
    }
    const ethsigNoType = await account.signMessage({
      message: { raw: hash },
    })
    return (
      ethsigNoType.endsWith('03') || ethsigNoType.endsWith('02')
        ? ethsigNoType
        : `${ethsigNoType}02`
    ) as Hex
  }

  async function signByOwners(
    owners: Account[],
    threshold: number,
    message: Hex,
  ): Promise<Hex> {
    const MODE_SIGNATURE = 0
    const weight = 1
    const sorted = owners.sort((a, b) => compareAddr(a.address, b.address))
    const signatures = await Promise.all(
      sorted.map(async (owner) => {
        const signature = await ethSign(owner, message)
        return encodePacked(
          ['uint8', 'uint8', 'bytes'],
          [MODE_SIGNATURE, weight, signature],
        )
      }),
    )
    return encodePacked(
      ['uint16', ...Array(owners.length).fill('bytes')],
      [Number(threshold), ...signatures],
    )
  }

  const data = encodeMetaTransactionsData(
    cfa,
    transactions,
    BigInt(chain.id),
    walletNonce,
  )
  console.log('data', data)
  console.log('data message hash', hashMessage(data))

  const walletOwnersSignature = await signByOwners(
    walletConfig.owners.map((owner) => owner.account),
    walletConfig.threshold,
    data,
  )
  console.log('data sig', walletOwnersSignature)
  return walletOwnersSignature
}

async function getDeployArgs(config: RhinestoneAccountConfig) {
  if (config.initData) {
    throw new Error('Existing account not supported for passport')
  }

  const moduleSetup = getModuleSetup(config)

  const bootstrapData = encodeFunctionData({
    abi: parseAbi([
      'struct BootstrapConfig {address module;bytes initData;}',
      'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
      'function initNexusNoRegistry(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks) external',
    ]),
    functionName: 'initNexusNoRegistry',
    args: [
      moduleSetup.validators.map((v) => ({
        module: v.address,
        initData: v.initData,
      })),
      moduleSetup.executors.map((e) => ({
        module: e.address,
        initData: e.initData,
      })),
      {
        module: zeroAddress,
        initData: '0x',
      },
      moduleSetup.fallbacks.map((f) => ({
        module: f.address,
        initData: f.initData,
      })),
      [],
    ],
  })
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [NEXUS_BOOTSTRAP_ADDRESS, bootstrapData],
  )
  const initializationCallData = encodeFunctionData({
    abi: parseAbi(['function initializeAccount(bytes)']),
    functionName: 'initializeAccount',
    args: [initData],
  })

  const mainModule = '0x0d1Bf2f4Ab334324665aeb8d481fF92CdE289439'
  const owners = config.owners
  if (owners.type !== 'ecdsa') {
    throw new Error('Only ecdsa owners are supported for passport')
  }
  const ownerAccounts = owners.accounts.map((owner) => ({
    weight: 1,
    account: owner,
  }))
  const deploySalt = encodeImageHash(1, ownerAccounts)
  const deployNonce = 0n

  const accountInitData = padHex(mainModule, { size: 32 })
  const account = getContractAddress({
    opcode: 'CREATE2',
    from: PASSPORT_FACTORY_ADDRESS,
    salt: deploySalt,
    bytecode: concat([CREATION_CODE, accountInitData]),
  })

  const deployTxs: Transaction[] = [
    {
      delegateCall: false,
      revertOnError: true,
      gasLimit: 1000000n,
      target: account,
      value: 0n,
      data: initializationCallData,
    },
  ]

  const chain = baseSepolia
  const deployOwnerSignature = await signOwner(
    account,
    deployNonce,
    deployTxs,
    chain,
    {
      threshold: 1,
      owners: ownerAccounts,
    },
  )

  const deployCallData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'deployAndExecute',
        inputs: [
          {
            type: 'address',
            name: 'cfa',
          },
          {
            type: 'address',
            name: '_mainModule',
          },
          {
            type: 'bytes32',
            name: '_salt',
          },
          {
            type: 'address',
            name: 'factory',
          },
          {
            type: 'tuple[]',
            components: [
              {
                type: 'bool',
                name: 'delegateCall',
              },
              {
                type: 'bool',
                name: 'revertOnError',
              },
              {
                type: 'uint256',
                name: 'gasLimit',
              },
              {
                type: 'address',
                name: 'target',
              },
              {
                type: 'uint256',
                name: 'value',
              },
              {
                type: 'bytes',
                name: 'data',
              },
            ],
            name: '_txs',
          },
          {
            type: 'uint256',
            name: '_nonce',
          },
          {
            type: 'bytes',
            name: '_signature',
          },
        ],
      },
    ],
    functionName: 'deployAndExecute',
    args: [
      account,
      mainModule,
      deploySalt,
      PASSPORT_FACTORY_ADDRESS,
      deployTxs,
      deployNonce,
      deployOwnerSignature,
    ],
  })
  const signerPk =
    '0x282cc46ff8a563ad052b2ed70150a186ef60281e3e76e2a7fe81615c2823444e'
  const signerAccount = privateKeyToAccount(signerPk)
  const deploySignature = await signerAccount.signMessage({
    message: {
      raw: keccak256(deployCallData),
    },
  })

  const factoryData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'deployAndExecuteWithSignature',
        inputs: [
          {
            type: 'address',
            name: 'cfa',
          },
          {
            type: 'address',
            name: '_mainModule',
          },
          {
            type: 'bytes32',
            name: '_salt',
          },
          {
            type: 'address',
            name: 'factory',
          },
          {
            type: 'tuple[]',
            components: [
              {
                type: 'bool',
                name: 'delegateCall',
              },
              {
                type: 'bool',
                name: 'revertOnError',
              },
              {
                type: 'uint256',
                name: 'gasLimit',
              },
              {
                type: 'address',
                name: 'target',
              },
              {
                type: 'uint256',
                name: 'value',
              },
              {
                type: 'bytes',
                name: 'data',
              },
            ],
            name: '_txs',
          },
          {
            type: 'uint256',
            name: '_nonce',
          },
          {
            type: 'bytes',
            name: '_walletOwnersSignature',
          },
          {
            type: 'bytes',
            name: '_executorSignature',
          },
        ],
      },
    ],
    functionName: 'deployAndExecuteWithSignature',
    args: [
      account,
      mainModule,
      deploySalt,
      PASSPORT_FACTORY_ADDRESS,
      deployTxs,
      deployNonce,
      deployOwnerSignature,
      deploySignature,
    ],
  })

  return {
    factory: PASSPORT_FACTORY_ADDRESS,
    factoryData,
    salt: deploySalt,
    implementation: PASSPORT_IMPLEMENTATION_ADDRESS,
    initializationCallData,
    initData,
  }
}

async function getAddress(config: RhinestoneAccountConfig) {
  const { factory, salt, initializationCallData } = await getDeployArgs(config)

  const creationCode = CREATION_CODE
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt,
    bytecode: concat([creationCode, initializationCallData]),
  })
  return address
}

function getInstallData(module: Module) {
  return getNexusInstallData(module)
}

async function packSignature(
  signature: Hex,
  validator: ValidatorConfig,
  transformSignature: (signature: Hex) => Hex = (signature) => signature,
) {
  return packNexusSignature(signature, validator, transformSignature)
}

async function getSmartAccount(
  client: PublicClient,
  address: Address,
  owners: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusSmartAccount(client, address, owners, validatorAddress, sign)
}

async function getSessionSmartAccount(
  client: PublicClient,
  address: Address,
  session: Session,
  validatorAddress: Address,
  enableData: EnableSessionData | null,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusSessionSmartAccount(
    client,
    address,
    session,
    validatorAddress,
    enableData,
    sign,
  )
}

async function getGuardianSmartAccount(
  client: PublicClient,
  address: Address,
  guardians: OwnerSet,
  validatorAddress: Address,
  sign: (hash: Hex) => Promise<Hex>,
) {
  return getNexusGuardianSmartAccount(
    client,
    address,
    guardians,
    validatorAddress,
    sign,
  )
}

export {
  getInstallData,
  getAddress,
  packSignature,
  getDeployArgs,
  getSmartAccount,
  getSessionSmartAccount,
  getGuardianSmartAccount,
}
