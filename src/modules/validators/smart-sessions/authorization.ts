import {
  type Address,
  hashStruct,
  maxUint256,
  type TypedDataDefinition,
} from 'viem'
import { getSessionData } from './digest'
import { getSmartSessionEmissaryAddress } from './module'
import {
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
} from './resolve'
import type { Session, SessionData, SessionDetails } from './types'

export const SESSION_LOCK_TAG = '0x000000000000000000000000' as const

export const sessionAuthorizationTypes = {
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
  LockTagData: [
    { name: 'lockTag', type: 'bytes12' },
    { name: 'claimPolicies', type: 'PolicyData[]' },
  ],
  SignedPermissions: [
    { name: 'actions', type: 'ActionData[]' },
    { name: 'erc7739Policies', type: 'ERC7739Data' },
    { name: 'lockTagPolicies', type: 'LockTagData' },
    { name: 'permitGenericPolicy', type: 'bool' },
  ],
  SignedSession: [
    { name: 'account', type: 'address' },
    { name: 'expires', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'permissions', type: 'SignedPermissions' },
    { name: 'salt', type: 'bytes32' },
    { name: 'sessionValidator', type: 'address' },
    { name: 'sessionValidatorInitData', type: 'bytes' },
    { name: 'smartSessionEmissary', type: 'address' },
  ],
  ChainSession: [
    { name: 'chainId', type: 'uint64' },
    { name: 'session', type: 'SignedSession' },
  ],
  MultiChainSession: [{ name: 'sessionsAndChainIds', type: 'ChainSession[]' }],
} as const

function signedSession(
  account: Address,
  data: SessionData,
  nonce: bigint,
  environment: 'production' | 'development',
) {
  return {
    account,
    permissions: {
      permitGenericPolicy: data.actions.some(
        (action) =>
          action.actionTarget === SMART_SESSIONS_FALLBACK_TARGET_FLAG &&
          action.actionTargetSelector ===
            SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
      ),
      lockTagPolicies: {
        lockTag: SESSION_LOCK_TAG,
        claimPolicies: data.claimPolicies,
      },
      erc7739Policies: {
        allowedERC7739Content: data.erc7739Policies.allowedERC7739Content.map(
          (content) => ({
            contentName: content.contentNames,
            appDomainSeparator: content.appDomainSeparator,
          }),
        ),
        erc1271Policies: data.erc7739Policies.erc1271Policies,
      },
      actions: data.actions,
    },
    sessionValidator: data.sessionValidator,
    sessionValidatorInitData: data.sessionValidatorInitData,
    salt: data.salt,
    smartSessionEmissary: getSmartSessionEmissaryAddress(environment),
    expires: maxUint256,
    nonce,
  }
}

export async function getSessionDetails(input: {
  readonly account: Address
  readonly sessions: readonly Session[]
  readonly environment: 'production' | 'development'
  readonly readNonce: (session: Session) => Promise<bigint>
}): Promise<SessionDetails> {
  const nonces = await Promise.all(input.sessions.map(input.readNonce))
  const signed = input.sessions.map((session, index) =>
    signedSession(
      input.account,
      getSessionData(session),
      nonces[index],
      input.environment,
    ),
  )
  const hashesAndChainIds = signed.map((session, index) => ({
    chainId: BigInt(input.sessions[index].chain.id),
    sessionDigest: hashStruct({
      types: sessionAuthorizationTypes,
      primaryType: 'SignedSession',
      data: session,
    }),
  }))
  const data: TypedDataDefinition<
    typeof sessionAuthorizationTypes,
    'MultiChainSession'
  > = {
    domain: { name: 'SmartSessionEmissary', version: '1' },
    types: sessionAuthorizationTypes,
    primaryType: 'MultiChainSession',
    message: {
      sessionsAndChainIds: signed.map((session, index) => ({
        chainId: BigInt(input.sessions[index].chain.id),
        session,
      })),
    },
  }
  return { nonces, hashesAndChainIds, data }
}
