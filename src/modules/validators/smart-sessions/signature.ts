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
    return encodePacked(
      ['bytes1', 'bytes32', 'uint256', 'bytes', 'bytes'],
      [
        SMART_SESSION_MODE_USE,
        permissionId,
        BigInt(64 + size(validatorSignature)),
        validatorSignature,
        signers.claimPolicyData ?? '0x',
      ],
    )
  }
  if (!signers.enableData) {
    return encodePacked(
      ['bytes1', 'bytes32', 'bytes'],
      [SMART_SESSION_MODE_USE, permissionId, validatorSignature],
    )
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
          userSig: signers.enableData.userSignature,
          expires: maxUint256,
          enableSession: {
            chainDigestIndex: signers.enableData.sessionToEnableIndex,
            hashesAndChainIds: [...signers.enableData.hashesAndChainIds],
            session: getSessionData(signers.session),
          },
        },
        {
          scope: SCOPE_MULTICHAIN,
          resetPeriod: RESET_PERIOD_ONE_WEEK,
          allocator: zeroAddress,
          permissionId,
        },
        validatorSignature,
      ],
    ),
  ) as Hex
  return encodePacked(
    ['bytes1', 'bytes'],
    [SMART_SESSION_MODE_ENABLE, compressed],
  )
}
