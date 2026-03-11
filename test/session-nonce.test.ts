/**
 * Debug test: compare what getSessionDetails fetches vs direct on-chain getNonce
 *
 * Run with:
 *   bun run test -- test/session-nonce.test.ts
 *
 * Set MAINNET_RPC_URL in your environment (or .env).
 */
import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, it } from 'vitest'

import {
  SMART_SESSION_EMISSARY_ADDRESS,
  getSessionDetails,
} from '../src/modules/validators/smart-sessions'

const ACCOUNT_ADDRESS =
  '0xb9414b2ee457c64feca464e1f757a62000b20e6d' as Address

const EMISSARY_ADDRESS = SMART_SESSION_EMISSARY_ADDRESS

const GET_NONCE_ABI = [
  {
    type: 'function',
    name: 'getNonce',
    inputs: [
      { name: 'sponsor', type: 'address' },
      { name: 'lockTag', type: 'bytes12' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const LOCK_TAG = '0x000000000000000000000000' as const

describe('session nonce debug', () => {
  it('compares direct getNonce vs getSessionDetails nonce', async () => {
    const rpcUrl = process.env.MAINNET_RPC_URL

    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    // 1. Direct on-chain call — what's actually stored
    const onChainNonce = await client.readContract({
      address: EMISSARY_ADDRESS,
      abi: GET_NONCE_ABI,
      functionName: 'getNonce',
      args: [ACCOUNT_ADDRESS, LOCK_TAG],
    })
    console.log('on-chain nonce (direct):', onChainNonce.toString())

    // 2. What getSessionDetails fetches via getSessionNonce
    // We pass a minimal session just to trigger the nonce fetch
    const { nonces, hashesAndChainIds } = await getSessionDetails(
      ACCOUNT_ADDRESS,
      [
        {
          chain: mainnet,
          owners: {
            type: 'ecdsa',
            accounts: [
              {
                address: '0x0000000000000000000000000000000000000001',
              } as any,
            ],
          },
        },
      ],
      rpcUrl ? { type: 'custom', urls: { [mainnet.id]: rpcUrl } } : undefined,
    )

    console.log('nonce from getSessionDetails:', nonces[0].toString())
    console.log('session digest (nonce=0 expected if bug):', hashesAndChainIds[0].sessionDigest)
    console.log(
      'account passed to getNonce in getSessionDetails:',
      ACCOUNT_ADDRESS,
    )
    console.log(
      'emissary address used as contract:',
      EMISSARY_ADDRESS,
    )

    if (onChainNonce !== nonces[0]) {
      console.error(
        `MISMATCH: on-chain=${onChainNonce}, sdk=${nonces[0]}`,
      )
    } else {
      console.log('MATCH: nonces are consistent')
    }
  })
})
