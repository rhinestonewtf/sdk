import {
  type Address,
  type Hex,
  hashStruct,
  isAddressEqual,
  maxUint256,
  size,
  sliceHex,
  type TypedDataDefinition,
} from 'viem'
import { getSessionData } from './digest'
import { getSmartSessionEmissaryAddress } from './module'
import { CONSUME_SELECTOR } from './one-time-use'
import { defaultOneTimeUseIdPolicy } from './policies/addresses'
import {
  SMART_SESSIONS_FALLBACK_TARGET_FLAG,
  SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG,
} from './resolve'
import type { Session, SessionData, SessionDetails } from './types'

export const SESSION_LOCK_TAG = '0x000000000000000000000000' as const

export const types = {
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

/**
 * Whether a policy's rules hold a crossChainPermits `maxAmount` cap: a
 * `cumulativeCap` (lessThanOrEqual, limited, the cap as reference and limit,
 * nothing used) on the amount word of an approve or a transfer, or, on a
 * SAME_CHAIN_IE swap, on the sell amount with its `to.minAmount` floor
 * (greaterThanOrEqual on the Swapper's output bound, word 96) after it. A plain
 * `swap` scope puts any floor before its cap. Rules are six-word tuples.
 */
function hasCapRule(initData: Hex, amountWord: boolean): boolean {
  const words = Array.from(
    { length: Math.floor(size(initData) / 32) },
    (_, i) => BigInt(sliceHex(initData, i * 32, i * 32 + 32)),
  )
  return words.some(
    (word, i) =>
      word === 4n &&
      words[i + 2] === 1n &&
      words[i + 3] !== undefined &&
      words[i + 3] === words[i + 4] &&
      words[i + 5] === 0n &&
      (amountWord
        ? words[i + 1] === 32n
        : words.some(
            (floor, j) =>
              j > i &&
              (j - i) % 6 === 0 &&
              floor === 3n &&
              words[j + 1] === 96n &&
              words[j + 2] === 0n,
          )),
  )
}

/**
 * Whether the session is one-time-use as compiled: a `consume` burn on its
 * OneTimeUseIdPolicy (the environment's default, or the one its metadata
 * names) and that policy on every action. A `consume` on any other target,
 * or the metadata alone, proves nothing.
 */
function isOneTimeUse(
  session: Session,
  environment: 'production' | 'development',
): boolean {
  const policies = [
    session.oneTimeUse?.policy,
    defaultOneTimeUseIdPolicy(session.chain.id, environment),
  ].filter((policy): policy is Address => policy !== undefined)
  return policies.some(
    (once) =>
      session.actions.some(
        (a) =>
          a.actionTargetSelector === CONSUME_SELECTOR &&
          isAddressEqual(a.actionTarget, once),
      ) &&
      session.actions.every((a) =>
        a.actionPolicies.some(({ policy }) => isAddressEqual(policy, once)),
      ),
  )
}

/**
 * Whether the session's maxAmount is a lifetime budget, from its actions as
 * well as its metadata, so a stored session missing the flag is still caught.
 * A hand-written rule of the same shape is guarded too, which fails closed.
 */
export function hasLifetimeBudget(
  session: Session,
  environment: 'production' | 'development',
): boolean {
  if (session.lifetimeBudget) return true
  if (isOneTimeUse(session, environment)) return false
  return session.actions.some(({ actionTargetSelector, actionPolicies }) => {
    // approve(address,uint256), transfer(address,uint256)
    const amountWord =
      actionTargetSelector === '0x095ea7b3' ||
      actionTargetSelector === '0xa9059cbb'
    return actionPolicies.some(({ initData }) =>
      hasCapRule(initData, amountWord),
    )
  })
}

export async function getSessionDetails(input: {
  readonly account: Address
  readonly sessions: readonly Session[]
  readonly environment: 'production' | 'development'
  readonly readNonce: (session: Session) => Promise<bigint>
  /**
   * The nonce and enabled state read together at one block, for sessions with
   * a lifetime budget only.
   */
  readonly readNonceAndEnabled?: (
    session: Session,
  ) => Promise<{ readonly nonce: bigint; readonly enabled: boolean }>
  readonly allowBudgetReset?: boolean
}): Promise<SessionDetails> {
  // An enable re-initialises the session's policies, so signing one for an
  // enabled session hands whoever submits it a fresh lifetime budget. The
  // nonce is read with the state: an enable after that block spends it.
  const guarded = (session: Session) =>
    !input.allowBudgetReset && hasLifetimeBudget(session, input.environment)
  const nonces = await Promise.all(
    input.sessions.map(async (session) => {
      if (!guarded(session)) return input.readNonce(session)
      if (!input.readNonceAndEnabled) {
        throw new Error(
          'getSessionDetails (internal): a lifetime-budget session needs readNonceAndEnabled',
        )
      }
      const { nonce, enabled } = await input.readNonceAndEnabled(session)
      if (enabled) {
        throw new Error(
          `The session ${session.permissionId} is already enabled on chain ${session.chain.id}, and its maxAmount is a lifetime budget: signing its enable again would reset that budget. Leave it out of getSessionDetails, or pass { allowBudgetReset: true } to reset it.`,
        )
      }
      return nonce
    }),
  )
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
      types,
      primaryType: 'SignedSession',
      data: session,
    }),
  }))
  const data: TypedDataDefinition<typeof types, 'MultiChainSession'> = {
    domain: { name: 'SmartSessionEmissary', version: '1' },
    types,
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
