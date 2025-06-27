import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  http,
  keccak256,
  PublicClient,
} from 'viem'
import {
  getAccountProvider,
  getAddress,
  getPackedSignature,
  getSmartAccount,
} from '../accounts'
import { getBundlerClient, ValidatorConfig } from '../accounts/utils'
import { getTrustAttesterCall, getTrustedAttesters } from '../modules'
import {
  getAccountEIP712Domain,
  getEnableSessionCall,
  getPermissionId,
  getSessionAllowedERC7739Content,
  isSessionEnabled,
  SMART_SESSION_MODE_ENABLE,
  SMART_SESSIONS_VALIDATOR_ADDRESS,
} from '../modules/validators'
import {
  ChainDigest,
  ChainSession,
  EnableSessionData,
  getSessionData,
  SessionData,
  SmartSessionModeType,
} from '../modules/validators/smart-sessions'
import type { OrderPath } from '../orchestrator'
import { hashMultichainCompactWithoutDomainSeparator } from '../orchestrator/utils'
import type { AccountType, RhinestoneAccountConfig, Session } from '../types'

interface SessionDetails {
  permissionEnableHash: Hex
  mode: SmartSessionModeType
  hashesAndChainIds: ChainDigest[]
  enableSessionData: EnableSessionData
}

async function getSessionDetails(
  config: RhinestoneAccountConfig,
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
  )
  const chain = sessions[sessionIndex].chain
  if (!chain) {
    throw new Error('Session chain is required')
  }
  const validator: ValidatorConfig = {
    address: sessionDetails.enableSessionData.validator,
    isRoot: true,
  }
  sessionDetails.enableSessionData.signature =
    signature ??
    (await getPackedSignature(
      config,
      config.owners,
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
) {
  const chainDigests: ChainDigest[] = []
  const chainSessions: ChainSession[] = []
  for (const session of sessions) {
    const permissionId = getPermissionId(session)

    const publicClient = createPublicClient({
      chain: session.chain,
      transport: http(),
    })

    const sessionChain = session.chain
    if (!sessionChain) {
      throw new Error('Session chain is required')
    }

    const sessionNonce = await getSessionNonce(
      publicClient,
      accountAddress,
      permissionId,
    )

    const sessionData = await getSessionData(sessionChain, session)

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
    throw new Error('Session chain is required')
  }
  const sessionData = await getSessionData(sessionChain, sessionToEnable)

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
  config: RhinestoneAccountConfig,
  session: Session,
) {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
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
  const enableSessionCall = await getEnableSessionCall(chain, session)

  const trustedAttesters = await getTrustedAttesters(publicClient, address)
  const trustAttesterCall =
    trustedAttesters.length === 0 ? getTrustAttesterCall(config) : undefined

  const smartAccount = await getSmartAccount(config, publicClient, chain)
  const bundlerClient = getBundlerClient(config, publicClient)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: trustAttesterCall
      ? [trustAttesterCall, enableSessionCall]
      : [enableSessionCall],
  })
  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

async function hashErc7739(
  sourceChain: Chain,
  orderPath: OrderPath,
  accountAddress: Address,
) {
  const publicClient = createPublicClient({
    chain: sourceChain,
    transport: http(),
  })

  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(sourceChain)
  // Create hash following ERC-7739 TypedDataSign workflow
  const typedDataSignTypehash = keccak256(
    encodePacked(
      ['string'],
      [
        'TypedDataSign(MultichainCompact contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)'.concat(
          contentsType,
        ),
      ],
    ),
  )
  // Original struct hash
  const structHash = hashMultichainCompactWithoutDomainSeparator(
    orderPath[0].orderBundle,
  )
  const { name, version, chainId, verifyingContract, salt } =
    await getAccountEIP712Domain(publicClient, accountAddress)
  // Final hash according to ERC-7739
  const hash = keccak256(
    encodePacked(
      ['bytes2', 'bytes32', 'bytes32'],
      [
        '0x1901',
        appDomainSeparator,
        keccak256(
          encodeAbiParameters(
            [
              { name: 'typedDataSignTypehash', type: 'bytes32' },
              { name: 'structHash', type: 'bytes32' },
              { name: 'name', type: 'bytes32' },
              { name: 'version', type: 'bytes32' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
              { name: 'salt', type: 'bytes32' },
            ],
            [
              typedDataSignTypehash,
              structHash,
              keccak256(encodePacked(['string'], [name])),
              keccak256(encodePacked(['string'], [version])),
              BigInt(Number(chainId)),
              verifyingContract,
              salt,
            ],
          ),
        ),
      ],
    ),
  )

  return {
    hash,
    appDomainSeparator,
    contentsType,
    structHash,
  }
}

function getSessionSignature(
  signature: Hex,
  appDomainSeparator: Hex,
  structHash: Hex,
  contentsType: string,
  withSession: Session,
) {
  const erc7739Signature = encodePacked(
    ['bytes', 'bytes32', 'bytes32', 'string', 'uint16'],
    [
      signature,
      appDomainSeparator,
      structHash,
      contentsType,
      contentsType.length,
    ],
  )
  // Pack with permissionId for smart session
  const wrappedSignature = encodePacked(
    ['bytes32', 'bytes'],
    [getPermissionId(withSession), erc7739Signature],
  )
  return wrappedSignature
}

export {
  enableSmartSession,
  hashErc7739,
  getSessionSignature,
  getSessionDetails,
  getMultichainDigest,
}
export type { SessionDetails }
