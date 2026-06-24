import { baseSepolia } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'

// getDisableSessionCall reads the emissary nonce via createPublicClient; stub it.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async () => 7n,
    }),
  }
})

import {
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  keccak256,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import smartSessionEmissaryAbi from '../abi/smart-session-emissary'
import {
  getDisableSessionCall,
  SMART_SESSION_EMISSARY_ADDRESS,
  toSession,
} from './smart-sessions'

const MOCK_NONCE = 7n
const LOCK_TAG: Hex = '0x000000000000000000000000'
const SIGNED_PERMISSION_DISABLE_TYPEHASH: Hex =
  '0x098b3120e60a8adc9d970dec9c1f8796974a3ab6154f995ad56ee7b9a38d8836'

const account = '0x1111111111111111111111111111111111111111' as const
const owner = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
)
const session = toSession({
  chain: baseSepolia,
  owners: { type: 'ecdsa', accounts: [owner] },
})
const expires = 1893456000n

describe('getDisableSessionCall', () => {
  test('encodes a no-allocator removeConfig with an empty user signature', async () => {
    const call = await getDisableSessionCall(
      account,
      session,
      expires,
      undefined,
      false,
    )

    expect(call.to.toLowerCase()).toBe(
      SMART_SESSION_EMISSARY_ADDRESS.toLowerCase(),
    )

    const { functionName, args } = decodeFunctionData({
      abi: smartSessionEmissaryAbi,
      data: call.data,
    })
    expect(functionName).toBe('removeConfig')

    const [decodedAccount, config, disableData] = args
    expect(decodedAccount.toLowerCase()).toBe(account.toLowerCase())
    expect(config.allocator).toBe(zeroAddress)
    expect(config.permissionId).toBe(session.permissionId)

    // No signatures: the account is msg.sender, so the emissary skips both.
    expect(disableData.userSig).toBe('0x')
    expect(disableData.allocatorSig).toBe('0x')
    expect(disableData.expires).toBe(expires)
    expect(disableData.session.chainDigestIndex).toBe(0)

    const [chainDigest] = disableData.session.hashesAndChainIds
    expect(chainDigest.chainId).toBe(BigInt(baseSepolia.id))

    // The leaf must equal HashLibV2.disableDigest(permissionId, account, nonce,
    // expires, lockTag) computed from the on-chain nonce.
    const expectedDigest = keccak256(
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
          account,
          session.permissionId,
          LOCK_TAG,
          expires,
          MOCK_NONCE,
        ],
      ),
    )
    expect(chainDigest.sessionDigest).toBe(expectedDigest)
  })
})
