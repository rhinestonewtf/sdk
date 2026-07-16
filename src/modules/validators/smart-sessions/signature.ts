import { LibZip } from 'solady'
import {
  encodeAbiParameters,
  encodePacked,
  type Hex,
  maxUint256,
  size,
  zeroAddress,
  zeroHash,
} from 'viem'
import type { SmartSessionEnableContributionData } from '../smart-session-signature-types'
import { getPermissionId, getSessionData } from './digest'
import type { ResolvedSessionSignerSet } from './types'

const SCOPE_MULTICHAIN = 0
const RESET_PERIOD_ONE_WEEK = 6
export const SMART_SESSION_MODE_USE = '0x00' as const
export const SMART_SESSION_MODE_ENABLE = '0x01' as const

export function encodeSmartSessionSignature(
  signers: ResolvedSessionSignerSet,
  validatorSignature: Hex,
): Hex {
  const permissionId = getPermissionId(signers.session)
  if (!signers.verifyExecutions) {
    return encodeSmartSessionContribution({
      mode: 'notarized',
      permissionId,
      signature: validatorSignature,
      ...(signers.claimPolicyData
        ? { claimPolicyData: signers.claimPolicyData }
        : {}),
    })
  }
  if (!signers.enableData) {
    return encodeSmartSessionContribution({
      mode: 'use',
      permissionId,
      signature: validatorSignature,
    })
  }
  return encodeSmartSessionContribution({
    mode: 'enable-and-use',
    permissionId,
    signature: validatorSignature,
    enableData: {
      ...signers.enableData,
      session: getSessionData(signers.session),
    },
  })
}

export function encodeSmartSessionContribution(input: {
  readonly mode: 'use' | 'enable-and-use' | 'pre-claim' | 'notarized'
  readonly permissionId: Hex
  readonly signature: Hex
  readonly claimPolicyData?: Hex
  readonly enableData?: SmartSessionEnableContributionData
}): Hex {
  if (input.mode !== 'enable-and-use') {
    if (input.mode === 'notarized') {
      return encodePacked(
        ['bytes1', 'bytes32', 'uint256', 'bytes', 'bytes'],
        [
          SMART_SESSION_MODE_USE,
          input.permissionId,
          BigInt(64 + size(input.signature)),
          input.signature,
          input.claimPolicyData ?? '0x',
        ],
      )
    }
    return encodePacked(
      ['bytes1', 'bytes32', 'bytes'],
      [SMART_SESSION_MODE_USE, input.permissionId, input.signature],
    )
  }
  if (!input.enableData) {
    throw new Error('Enable-and-use signatures require enable data')
  }
  const compressed = LibZip.flzCompress(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          name: 'enableData',
          components: [
            { type: 'bytes', name: 'allocatorSig' },
            { type: 'bytes', name: 'userSig' },
            { type: 'uint256', name: 'expires' },
            {
              type: 'tuple',
              name: 'enableSession',
              components: [
                { type: 'uint8', name: 'chainDigestIndex' },
                {
                  type: 'tuple[]',
                  name: 'hashesAndChainIds',
                  components: [
                    { type: 'uint64', name: 'chainId' },
                    { type: 'bytes32', name: 'sessionDigest' },
                  ],
                },
                {
                  type: 'tuple',
                  name: 'session',
                  components: [
                    { type: 'address', name: 'sessionValidator' },
                    { type: 'bytes', name: 'sessionValidatorInitData' },
                    { type: 'bytes32', name: 'salt' },
                    {
                      type: 'tuple[]',
                      name: 'actions',
                      components: [
                        { type: 'bytes4', name: 'actionTargetSelector' },
                        { type: 'address', name: 'actionTarget' },
                        {
                          type: 'tuple[]',
                          name: 'actionPolicies',
                          components: [
                            { type: 'address', name: 'policy' },
                            { type: 'bytes', name: 'initData' },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'tuple[]',
                      name: 'claimPolicies',
                      components: [
                        { type: 'address', name: 'policy' },
                        { type: 'bytes', name: 'initData' },
                      ],
                    },
                    {
                      type: 'tuple',
                      name: 'erc7739Policies',
                      components: [
                        {
                          type: 'tuple[]',
                          name: 'allowedERC7739Content',
                          components: [
                            {
                              type: 'bytes32',
                              name: 'appDomainSeparator',
                            },
                            { type: 'string[]', name: 'contentNames' },
                          ],
                        },
                        {
                          type: 'tuple[]',
                          name: 'erc1271Policies',
                          components: [
                            { type: 'address', name: 'policy' },
                            { type: 'bytes', name: 'initData' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'tuple',
          name: 'config',
          components: [
            { type: 'uint8', name: 'scope' },
            { type: 'uint8', name: 'resetPeriod' },
            { type: 'address', name: 'allocator' },
            { type: 'bytes32', name: 'permissionId' },
          ],
        },
        { type: 'bytes' },
      ],
      [
        {
          allocatorSig: zeroHash,
          userSig: input.enableData.userSignature,
          expires: maxUint256,
          enableSession: {
            chainDigestIndex: input.enableData.sessionToEnableIndex,
            hashesAndChainIds: [...input.enableData.hashesAndChainIds],
            session: input.enableData.session,
          },
        },
        {
          scope: SCOPE_MULTICHAIN,
          resetPeriod: RESET_PERIOD_ONE_WEEK,
          allocator: zeroAddress,
          permissionId: input.permissionId,
        },
        input.signature,
      ],
    ),
  ) as Hex
  return encodePacked(
    ['bytes1', 'bytes'],
    [SMART_SESSION_MODE_ENABLE, compressed],
  )
}
