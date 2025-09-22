import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  encodePacked,
  type Hex,
  keccak256,
  type PublicClient,
} from 'viem'
import {
  getAccountProvider,
  getAddress,
  getPackedSignature,
  getSmartAccount,
} from '../accounts'
import {
  createTransport,
  getBundlerClient,
  type ValidatorConfig,
} from '../accounts/utils'
import {
  getEnableSessionCall,
  getPermissionId,
  isSessionEnabled,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSIONS_VALIDATOR_ADDRESS,
} from '../modules/validators'
import {
  type ChainDigest,
  type ChainSession,
  type EnableSessionData,
  getSessionData,
  type SessionData,
  type SmartSessionModeType,
} from '../modules/validators/smart-sessions'
import type {
  AccountType,
  ProviderConfig,
  RhinestoneConfig,
  Session,
} from '../types'
import { SessionChainRequiredError } from './error'

interface SessionDetails {
  permissionEnableHash: Hex
  mode: SmartSessionModeType
  hashesAndChainIds: ChainDigest[]
  enableSessionData: EnableSessionData
}

async function getSessionDetails(
  config: RhinestoneConfig,
  sessions: Session[],
  sessionIndex: number,
  signature?: Hex,
): Promise<SessionDetails> {
  const account = getAccountProvider(config)
  const accountAddress = getAddress(config)
  const sessionDetails = await getEnableSessionDetails(
    account.type,
    sessions,
    sessionIndex,
    accountAddress,
    config.provider,
  )
  const chain = sessions[sessionIndex].chain
  if (!chain) {
    throw new SessionChainRequiredError()
  }
  const validator: ValidatorConfig = {
    address: sessionDetails.enableSessionData.validator,
    isRoot: true,
  }
  sessionDetails.enableSessionData.signature =
    signature ??
    (await getPackedSignature(
      config,
      undefined,
      chain,
      validator,
      sessionDetails.permissionEnableHash,
    ))
  return sessionDetails
}

async function getEnableSessionDetails(
  accountType: AccountType,
  sessions: Session[],
  sessionIndex: number,
  accountAddress: Address,
  provider?: ProviderConfig,
) {
  const chainDigests: ChainDigest[] = []
  const chainSessions: ChainSession[] = []
  for (const session of sessions) {
    const permissionId = getPermissionId(session)

    const sessionChain = session.chain
    if (!sessionChain) {
      throw new SessionChainRequiredError()
    }

    const publicClient = createPublicClient({
      chain: sessionChain,
      transport: createTransport(sessionChain, provider),
    })

    const sessionNonce = await getSessionNonce(
      publicClient,
      accountAddress,
      permissionId,
    )

    const sessionData = await getSessionData(sessionChain, session, provider)

    const sessionDigest = await getSessionDigest(
      publicClient,
      accountAddress,
      sessionData,
      permissionId,
      SMART_SESSION_MODE_ENABLE,
    )

    chainDigests.push({
      chainId: BigInt(sessionChain.id),
      sessionDigest,
    })

    chainSessions.push({
      chainId: BigInt(sessionChain.id),
      session: {
        permissions: {
          permitGenericPolicy: false,
          permitAdminAccess: false,
          ignoreSecurityAttestations: false,
          permitERC4337Paymaster: sessionData.permitERC4337Paymaster,
          userOpPolicies: sessionData.userOpPolicies,
          erc7739Policies: sessionData.erc7739Policies,
          actions: sessionData.actions,
        },
        salt: sessionData.salt,
        sessionValidator: sessionData.sessionValidator,
        sessionValidatorInitData: sessionData.sessionValidatorInitData,
        account: accountAddress,
        smartSession: SMART_SESSIONS_VALIDATOR_ADDRESS,
        nonce: sessionNonce,
      },
    })
  }

  const permissionEnableHash = getMultichainDigest(chainDigests)

  const sessionToEnable = sessions[sessionIndex || 0]
  const sessionChain = sessionToEnable.chain
  if (!sessionChain) {
    throw new SessionChainRequiredError()
  }
  const sessionData = await getSessionData(
    sessionChain,
    sessionToEnable,
    provider,
  )

  return {
    permissionEnableHash,
    mode: SMART_SESSION_MODE_ENABLE as SmartSessionModeType,
    hashesAndChainIds: chainDigests,
    enableSessionData: {
      permissionId: getPermissionId(sessionToEnable),
      validator: sessionData.sessionValidator,
      accountType,
      chainDigestIndex: sessionIndex,
      hashesAndChainIds: chainDigests,
      sessionToEnable: sessionData,
      signature: '0x' as Hex,
    },
  }
}

function getMultichainDigest(chainDigests: ChainDigest[]): Hex {
  function hashChainDigestMimicRPC(chainDigest: ChainDigest): Hex {
    const CHAIN_SESSION_TYPEHASH =
      '0x1ea7e4bc398fa0ccd68d92b5d8931a3fd93eebe1cf0391b4ba28935801af7c80'
    return keccak256(
      encodePacked(
        ['bytes32', 'uint256', 'bytes32'],
        [
          CHAIN_SESSION_TYPEHASH,
          chainDigest.chainId,
          chainDigest.sessionDigest,
        ],
      ),
    )
  }

  function hashChainDigestArray(chainDigests: ChainDigest[]): Hex {
    const hashes = chainDigests.map((digest) => hashChainDigestMimicRPC(digest))
    return keccak256(concat(hashes))
  }

  const MULTICHAIN_SESSION_TYPEHASH =
    '0x0c9d02fb89a1da34d66ea2088dc9ee6a58efee71cef6f1bb849ed74fc6003d98'
  const MULTICHAIN_DOMAIN_SEPARATOR =
    '0x057501e891776d1482927e5f094ae44049a4d893ba2d7b334dd7db8d38d3a0e1'
  const structHash = keccak256(
    encodePacked(
      ['bytes32', 'bytes32'],
      [MULTICHAIN_SESSION_TYPEHASH, hashChainDigestArray(chainDigests)],
    ),
  )
  return keccak256(concat(['0x1901', MULTICHAIN_DOMAIN_SEPARATOR, structHash]))
}

async function getSessionNonce(
  client: PublicClient,
  account: Address,
  permissionId: Hex,
) {
  return (await client.readContract({
    address: SMART_SESSIONS_VALIDATOR_ADDRESS,
    abi: [
      {
        type: 'function',
        name: 'getNonce',
        inputs: [
          {
            name: 'permissionId',
            type: 'bytes32',
            internalType: 'PermissionId',
          },
          { name: 'account', type: 'address', internalType: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'getNonce',
    args: [permissionId, account],
  })) as bigint
}

async function getSessionDigest(
  client: PublicClient,
  account: Address,
  session: SessionData,
  permissionId: Hex,
  mode: SmartSessionModeType,
) {
  return (await client.readContract({
    address: SMART_SESSIONS_VALIDATOR_ADDRESS,
    abi: [
      {
        type: 'function',
        name: 'getSessionDigest',
        inputs: [
          {
            name: 'permissionId',
            type: 'bytes32',
            internalType: 'PermissionId',
          },
          { name: 'account', type: 'address', internalType: 'address' },
          {
            name: 'data',
            type: 'tuple',
            internalType: 'struct Session',
            components: [
              {
                name: 'sessionValidator',
                type: 'address',
                internalType: 'contract ISessionValidator',
              },
              {
                name: 'sessionValidatorInitData',
                type: 'bytes',
                internalType: 'bytes',
              },
              { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
              {
                name: 'userOpPolicies',
                type: 'tuple[]',
                internalType: 'struct PolicyData[]',
                components: [
                  {
                    name: 'policy',
                    type: 'address',
                    internalType: 'address',
                  },
                  { name: 'initData', type: 'bytes', internalType: 'bytes' },
                ],
              },
              {
                name: 'erc7739Policies',
                type: 'tuple',
                internalType: 'struct ERC7739Data',
                components: [
                  {
                    name: 'allowedERC7739Content',
                    type: 'tuple[]',
                    internalType: 'struct ERC7739Context[]',
                    components: [
                      {
                        name: 'appDomainSeparator',
                        type: 'bytes32',
                        internalType: 'bytes32',
                      },
                      {
                        name: 'contentName',
                        type: 'string[]',
                        internalType: 'string[]',
                      },
                    ],
                  },
                  {
                    name: 'erc1271Policies',
                    type: 'tuple[]',
                    internalType: 'struct PolicyData[]',
                    components: [
                      {
                        name: 'policy',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'initData',
                        type: 'bytes',
                        internalType: 'bytes',
                      },
                    ],
                  },
                ],
              },
              {
                name: 'actions',
                type: 'tuple[]',
                internalType: 'struct ActionData[]',
                components: [
                  {
                    name: 'actionTargetSelector',
                    type: 'bytes4',
                    internalType: 'bytes4',
                  },
                  {
                    name: 'actionTarget',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'actionPolicies',
                    type: 'tuple[]',
                    internalType: 'struct PolicyData[]',
                    components: [
                      {
                        name: 'policy',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'initData',
                        type: 'bytes',
                        internalType: 'bytes',
                      },
                    ],
                  },
                ],
              },
              {
                name: 'permitERC4337Paymaster',
                type: 'bool',
                internalType: 'bool',
              },
            ],
          },
          {
            name: 'mode',
            type: 'uint8',
            internalType: 'enum SmartSessionMode',
          },
        ],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'getSessionDigest',
    // @ts-ignore Viem fails to infer the type of "session"
    args: [permissionId, account, session, Number(mode)],
  })) as Hex
}

async function enableSmartSession(
  chain: Chain,
  config: RhinestoneConfig,
  session: Session,
) {
  const publicClient = createPublicClient({
    chain,
    transport: createTransport(chain, config.provider),
  })
  const address = getAddress(config)

  const isEnabled = await isSessionEnabled(
    publicClient,
    address,
    getPermissionId(session),
  )
  if (isEnabled) {
    return
  }
  const enableSessionCall = await getEnableSessionCall(
    chain,
    session,
    config.provider,
  )

  const smartAccount = await getSmartAccount(config, publicClient, chain)
  const bundlerClient = getBundlerClient(config, publicClient)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [enableSessionCall],
  })
  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

export { enableSmartSession, getSessionDetails, getMultichainDigest }
export type { SessionDetails }
