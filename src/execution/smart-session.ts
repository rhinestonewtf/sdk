import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  hashStruct,
  type PublicClient,
  type TypedDataDefinition,
} from 'viem'
import {
  getAddress,
  getSmartAccount,
  getTypedDataPackedSignature,
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
  SMART_SESSIONS_VALIDATOR_ADDRESS,
} from '../modules/validators'
import {
  type EnableSessionData,
  getSmartSessionData,
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
} from '../modules/validators/smart-sessions'
import type { RhinestoneConfig, Session } from '../types'
import { SessionChainRequiredError } from './error'

interface SessionDetails {
  signature: Hex
  nonces: bigint[]
  enableSessionData: EnableSessionData
}

const smartSessionTypes = {
  PolicyData: [
    { name: 'policy', type: 'address' },
    { name: 'initData', type: 'bytes' },
  ],
  ActionData: [
    { name: 'actionTargetSelector', type: 'bytes4' },
    { name: 'actionTarget', type: 'address' },
    { name: 'actionPolicies', type: 'PolicyData[]' },
  ],
  ERC7739Context: [
    { name: 'appDomainSeparator', type: 'bytes32' },
    { name: 'contentName', type: 'string[]' },
  ],
  ERC7739Data: [
    { name: 'allowedERC7739Content', type: 'ERC7739Context[]' },
    { name: 'erc1271Policies', type: 'PolicyData[]' },
  ],
  SignedPermissions: [
    { name: 'permitGenericPolicy', type: 'bool' },
    { name: 'permitAdminAccess', type: 'bool' },
    { name: 'ignoreSecurityAttestations', type: 'bool' },
    { name: 'permitERC4337Paymaster', type: 'bool' },
    { name: 'userOpPolicies', type: 'PolicyData[]' },
    { name: 'erc7739Policies', type: 'ERC7739Data' },
    { name: 'actions', type: 'ActionData[]' },
  ],
  SignedSession: [
    { name: 'account', type: 'address' },
    { name: 'permissions', type: 'SignedPermissions' },
    { name: 'sessionValidator', type: 'address' },
    { name: 'sessionValidatorInitData', type: 'bytes' },
    { name: 'salt', type: 'bytes32' },
    { name: 'smartSession', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
  ChainSession: [
    { name: 'chainId', type: 'uint64' },
    { name: 'session', type: 'SignedSession' },
  ],
  MultiChainSession: [{ name: 'sessionsAndChainIds', type: 'ChainSession[]' }],
} as const

async function getSessionDetails(
  config: RhinestoneConfig,
  sessions: Session[],
  sessionIndex: number,
  initialNonces?: bigint[],
  signature?: Hex,
): Promise<SessionDetails> {
  const chains = sessions
    .map((session) => session.chain)
    .filter((chain) => !!chain)
  if (chains.length !== sessions.length) {
    throw new SessionChainRequiredError()
  }

  const accountAddress = getAddress(config)

  const publicClients = chains.map((chain) =>
    createPublicClient({
      chain,
      transport: createTransport(chain, config.provider),
    }),
  )
  const sessionDatas = sessions.map((session) => getSmartSessionData(session))
  const sessionNonces = await Promise.all(
    sessions.map(
      (session, index) =>
        initialNonces?.[index] ??
        getSessionNonce(
          publicClients[index],
          accountAddress,
          getPermissionId(session),
        ),
    ),
  )

  const signedSessions = sessionDatas.map((session, index) => ({
    account: accountAddress,
    permissions: {
      permitGenericPolicy: session.actions.some(
        (action) =>
          action.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG &&
          action.actionTargetSelector ===
            SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
      ),
      permitAdminAccess: session.actions.some(
        (action) =>
          action.actionTargetSelector ===
          SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION,
      ),
      ignoreSecurityAttestations: false,
      permitERC4337Paymaster: session.permitERC4337Paymaster,
      userOpPolicies: session.userOpPolicies,
      erc7739Policies: session.erc7739Policies,
      actions: session.actions,
    },
    sessionValidator: session.sessionValidator,
    sessionValidatorInitData: session.sessionValidatorInitData,
    salt: session.salt,
    smartSession: SMART_SESSIONS_VALIDATOR_ADDRESS,
    nonce: sessionNonces[index],
  }))

  const chainDigests = signedSessions.map((session, index) => ({
    chainId: BigInt(chains[index].id),
    sessionDigest: hashStruct({
      types: smartSessionTypes,
      primaryType: 'SignedSession',
      data: session,
    }),
  }))

  const typedData: TypedDataDefinition<
    typeof smartSessionTypes,
    'MultiChainSession'
  > = {
    domain: {
      name: 'SmartSession',
      version: '1',
    },
    types: smartSessionTypes,
    primaryType: 'MultiChainSession',
    message: {
      sessionsAndChainIds: signedSessions.map((session, index) => ({
        chainId: BigInt(chains[index].id),
        session,
      })),
    },
  }

  const chain = sessions[sessionIndex].chain
  if (!chain) {
    throw new SessionChainRequiredError()
  }
  const validator: ValidatorConfig = {
    address: sessionDatas[sessionIndex].sessionValidator,
    isRoot: false,
  }
  const sessionSignature =
    signature ??
    (await getTypedDataPackedSignature(
      config,
      undefined,
      chain,
      validator,
      typedData,
    ))
  return {
    nonces: sessionNonces,
    signature: sessionSignature,
    enableSessionData: {
      chainDigestIndex: sessionIndex,
      hashesAndChainIds: chainDigests.map((chainDigest) => ({
        chainId: BigInt(chainDigest.chainId),
        sessionDigest: chainDigest.sessionDigest,
      })),
      sessionToEnable: sessionDatas[sessionIndex],
      signature: sessionSignature,
    },
  }
}

async function getSessionNonce(
  client: PublicClient,
  account: Address,
  permissionId: Hex,
) {
  const nonce = await client.readContract({
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
  })
  return nonce
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
  const enableSessionCall = await getEnableSessionCall(session)

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

export { enableSmartSession, getSessionDetails }
export type { SessionDetails }
