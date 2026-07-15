import type { Hex } from 'viem'
import type { UserOperation } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import {
  type PreparedUserOperationData,
  type RhinestoneAccount,
  RhinestoneSDK,
  type SignedUserOperationData,
} from '../../../src/index'
import { createFakeRpc, type FakeRpc } from '../../fakes/rpc'

const OWNER = privateKeyToAccount(`0x${'01'.repeat(32)}`)
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const USER_OPERATION_HASH = `0x${'12'.repeat(32)}` as Hex

describe('legacy UserOperation offline port evidence', () => {
  test('user-operations/entrypoint-0.7-sponsored-prepare-sign', async () => {
    const { account, rpc } = await createAccount()
    try {
      const prepared = await prepare(account)
      const signed = await account.signUserOperation({
        ...prepared,
        userOperation: withPaymaster(prepared.userOperation),
      })

      expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/u)
      expect(signed.userOperation.paymaster).toBe(`0x${'22'.repeat(20)}`)
    } finally {
      await rpc.close()
    }
  })

  test('user-operations/unsponsored-nonce-key', async () => {
    const { account, rpc } = await createAccount()
    try {
      const prepared = await prepare(account)
      const nonceKey = 7n << 64n
      const signed = await account.signUserOperation({
        ...prepared,
        userOperation: { ...prepared.userOperation, nonce: nonceKey },
      })

      expect(signed.userOperation.nonce).toBe(nonceKey)
      expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/u)
    } finally {
      await rpc.close()
    }
  })

  test('user-operations/custom-bundler-paymaster-wallet-switch', async () => {
    const { account, rpc } = await createAccount({
      responses: { eth_sendUserOperation: USER_OPERATION_HASH },
    })
    try {
      let resolvedChain = 0
      const prepared = await account.prepareUserOperation({
        chain: baseSepolia,
        calls: [
          {
            async resolve({ chain }) {
              resolvedChain = chain.id
              return { to: `0x${'11'.repeat(20)}`, value: 0n, data: '0x' }
            },
          },
        ],
      })
      const signed = await account.signUserOperation(prepared)
      const result = await account.submitUserOperation({
        ...signed,
        userOperation: withPaymaster(signed.userOperation),
      })

      expect(resolvedChain).toBe(baseSepolia.id)
      expect(result).toEqual({
        type: 'userop',
        hash: USER_OPERATION_HASH,
        chain: baseSepolia.id,
      })
      expect(rpc.requests.map(({ method }) => method)).toContain(
        'eth_estimateUserOperationGas',
      )
      expect(rpc.requests.map(({ method }) => method)).toContain(
        'eth_sendUserOperation',
      )
      expect(
        rpc.requests.find(({ method }) => method === 'eth_sendUserOperation')
          ?.params,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ paymaster: `0x${'22'.repeat(20)}` }),
        ]),
      )
    } finally {
      await rpc.close()
    }
  })

  test('user-operations/submit-sponsored-receipt', async () => {
    const receipt = userOperationReceipt()
    const { account, rpc } = await createAccount({
      responses: {
        eth_sendUserOperation: USER_OPERATION_HASH,
        eth_getUserOperationReceipt: receipt,
      },
    })
    try {
      const result = await account.submitUserOperation(
        signedUserOperation(account),
      )
      const observed = await account.waitForExecution(result)

      expect(observed.success).toBe(true)
      expect(observed.userOpHash).toBe(USER_OPERATION_HASH)
      expect(rpc.requests.map(({ method }) => method)).toEqual([
        'eth_sendUserOperation',
        'eth_getUserOperationReceipt',
      ])
    } finally {
      await rpc.close()
    }
  })

  test('user-operations/already-used-nonce', async () => {
    const { account, rpc } = await createAccount({
      errors: {
        eth_sendUserOperation: {
          code: -32500,
          message: 'AA25 invalid account nonce',
        },
      },
    })
    try {
      await expect(
        account.submitUserOperation(signedUserOperation(account)),
      ).rejects.toMatchObject({
        name: 'RpcRequestError',
        message: expect.stringContaining('AA25 invalid account nonce'),
      })
    } finally {
      await rpc.close()
    }
  })
})

async function createAccount(
  options: {
    responses?: Readonly<Record<string, unknown>>
    errors?: Readonly<Record<string, { code: number; message: string }>>
  } = {},
): Promise<{ account: RhinestoneAccount; rpc: FakeRpc }> {
  const rpc = await createFakeRpc({
    chainId: baseSepolia.id,
    code: '0x',
    responses: { ...baseRpcResponses(), ...options.responses },
    errors: options.errors,
  })
  const sdk = new RhinestoneSDK({
    apiKey: 'offline-characterization',
    provider: { type: 'custom', urls: { [baseSepolia.id]: rpc.url } },
    bundler: { type: 'custom', url: rpc.url },
  })
  return {
    account: await sdk.createAccount({
      account: { type: 'nexus' },
      owners: { type: 'ecdsa', accounts: [OWNER] },
    }),
    rpc,
  }
}

function prepare(
  account: RhinestoneAccount,
): Promise<PreparedUserOperationData> {
  return account.prepareUserOperation({
    chain: baseSepolia,
    calls: [{ to: `0x${'11'.repeat(20)}`, value: 0n, data: '0x' }],
  })
}

function signedUserOperation(
  account: RhinestoneAccount,
): SignedUserOperationData {
  return {
    hash: `0x${'00'.repeat(32)}`,
    transaction: { chain: baseSepolia, calls: [] },
    userOperation: {
      sender: account.getAddress(),
      nonce: 0n,
      callData: '0x',
      callGasLimit: 1n,
      verificationGasLimit: 1n,
      preVerificationGas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      signature: '0x',
    },
    signature: `0x${'ab'.repeat(65)}`,
  }
}

function withPaymaster(userOperation: UserOperation): UserOperation<'0.7'> {
  return {
    ...(userOperation as UserOperation<'0.7'>),
    paymaster: `0x${'22'.repeat(20)}`,
    paymasterVerificationGasLimit: 2n,
    paymasterPostOpGasLimit: 3n,
    paymasterData: '0x1234',
  }
}

function baseRpcResponses(): Readonly<Record<string, unknown>> {
  return {
    eth_getBlockByNumber: fakeBlock(),
    eth_call: `0x${'00'.repeat(32)}`,
    eth_maxPriorityFeePerGas: '0x1',
    eth_gasPrice: '0x2',
    eth_estimateUserOperationGas: {
      preVerificationGas: '0x1',
      verificationGasLimit: '0x2',
      callGasLimit: '0x3',
    },
  }
}

function fakeBlock() {
  const zero = (bytes: number) => `0x${'00'.repeat(bytes)}`
  return {
    number: '0x1',
    hash: zero(32),
    parentHash: zero(32),
    nonce: '0x0000000000000000',
    sha3Uncles: zero(32),
    logsBloom: zero(256),
    transactionsRoot: zero(32),
    stateRoot: zero(32),
    receiptsRoot: zero(32),
    miner: zero(20),
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x1',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    timestamp: '0x1',
    transactions: [],
    uncles: [],
    baseFeePerGas: '0x1',
    mixHash: zero(32),
  }
}

function userOperationReceipt() {
  const zero = (bytes: number) => `0x${'00'.repeat(bytes)}`
  const address = `0x${'11'.repeat(20)}`
  return {
    userOpHash: USER_OPERATION_HASH,
    entryPoint: ENTRY_POINT,
    sender: address,
    nonce: '0x0',
    actualGasCost: '0x1',
    actualGasUsed: '0x1',
    success: true,
    logs: [],
    receipt: {
      transactionHash: `0x${'56'.repeat(32)}`,
      transactionIndex: '0x0',
      blockHash: `0x${'34'.repeat(32)}`,
      blockNumber: '0x1',
      from: address,
      to: address,
      cumulativeGasUsed: '0x1',
      gasUsed: '0x1',
      contractAddress: null,
      logs: [],
      logsBloom: zero(256),
      status: '0x1',
      effectiveGasPrice: '0x1',
      type: '0x2',
    },
  }
}
