import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  maxUint256,
  zeroAddress,
  zeroHash,
} from 'viem'
import type { Call } from '../../../calls/types'
import smartSessionEmissaryAbi from '../../abi/smart-session-emissary'
import { SESSION_LOCK_TAG } from './authorization'
import { getPermissionId, getSessionData } from './digest'
import { getSmartSessionEmissaryAddress } from './module'
import type { ChainDigest, Session } from './types'

const SCOPE_MULTICHAIN = 0
const RESET_PERIOD_ONE_WEEK = 6
const SIGNED_PERMISSION_DISABLE_TYPEHASH =
  '0x098b3120e60a8adc9d970dec9c1f8796974a3ab6154f995ad56ee7b9a38d8836' as const

function config(permissionId: Hex) {
  return {
    scope: SCOPE_MULTICHAIN,
    resetPeriod: RESET_PERIOD_ONE_WEEK,
    allocator: zeroAddress,
    permissionId,
  }
}

export function encodeEnableSessionCall(input: {
  readonly account: Address
  readonly session: Session
  readonly userSignature: Hex
  readonly hashesAndChainIds: readonly ChainDigest[]
  readonly sessionToEnableIndex: number
  readonly environment: 'production' | 'development'
}): Call {
  const permissionId = getPermissionId(input.session)
  return {
    target: getSmartSessionEmissaryAddress(input.environment),
    value: 0n,
    data: encodeFunctionData({
      abi: smartSessionEmissaryAbi,
      functionName: 'setConfig',
      args: [
        input.account,
        config(permissionId),
        {
          allocatorSig: zeroHash,
          userSig: input.userSignature,
          expires: maxUint256,
          session: {
            chainDigestIndex: input.sessionToEnableIndex,
            hashesAndChainIds: [...input.hashesAndChainIds],
            sessionToEnable: getSessionData(input.session),
          },
        },
      ],
    }),
  }
}

export function encodeDisableSessionCall(input: {
  readonly account: Address
  readonly session: Session
  readonly expires: bigint
  readonly nonce: bigint
  readonly environment: 'production' | 'development'
}): Call {
  const permissionId = getPermissionId(input.session)
  const disableDigest = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes12' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        SIGNED_PERMISSION_DISABLE_TYPEHASH,
        input.account,
        permissionId,
        SESSION_LOCK_TAG,
        input.expires,
        input.nonce,
      ],
    ),
  )
  return {
    target: getSmartSessionEmissaryAddress(input.environment),
    value: 0n,
    data: encodeFunctionData({
      abi: smartSessionEmissaryAbi,
      functionName: 'removeConfig',
      args: [
        input.account,
        config(permissionId),
        {
          allocatorSig: '0x',
          userSig: '0x',
          expires: input.expires,
          session: {
            chainDigestIndex: 0,
            hashesAndChainIds: [
              {
                chainId: BigInt(input.session.chain.id),
                sessionDigest: disableDigest,
              },
            ],
          },
        },
      ],
    }),
  }
}
