import {
  AccountLayout,
  AccountState,
  getAccount,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  TokenInvalidAccountSizeError,
} from '@solana/spl-token'
import {
  type AccountInfo,
  type Connection,
  Keypair,
  SystemProgram,
} from '@solana/web3.js'
import { describe, expect, test, vi } from 'vitest'
import { DEVNET_USDC, readSolanaBalances, usdcAta } from './rpc'

const owner = Keypair.generate().publicKey
const ata = usdcAta(owner)

function tokenInfo(
  overrides: Partial<Parameters<typeof AccountLayout.encode>[0]> = {},
): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span)
  AccountLayout.encode(
    {
      mint: DEVNET_USDC,
      owner,
      amount: 9_007_199_254_740_993n,
      delegateOption: 0,
      delegate: SystemProgram.programId,
      state: AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: SystemProgram.programId,
      ...overrides,
    },
    data,
  )
  return {
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
    lamports: 2_039_280,
    rentEpoch: 0,
  }
}

function connectionFor(info: AccountInfo<Buffer> | null) {
  const getAccountInfo = vi.fn().mockResolvedValue(info)
  const getBalance = vi.fn().mockResolvedValue(10_000_000)
  const getMinimumBalanceForRentExemption = vi.fn().mockResolvedValue(890_880)
  const connection = {
    getAccountInfo,
    getBalance,
    getMinimumBalanceForRentExemption,
  } as unknown as Connection
  return {
    connection,
    getAccountInfo,
    getBalance,
    getMinimumBalanceForRentExemption,
  }
}

describe('readSolanaBalances with the real SPL decoder', () => {
  test('fetches the ATA once and decodes its exact bigint amount', async () => {
    const rpc = connectionFor(tokenInfo())
    await expect(readSolanaBalances(rpc.connection, owner)).resolves.toEqual({
      ata,
      usdc: 9_007_199_254_740_993n,
      lamports: 10_000_000n,
      rentExemptReserve: 890_880n,
      spendableLamports: 9_109_120n,
    })
    expect(rpc.getAccountInfo).toHaveBeenCalledExactlyOnceWith(ata, 'confirmed')
    expect(rpc.getBalance).toHaveBeenCalledExactlyOnceWith(owner, 'confirmed')
    expect(
      rpc.getMinimumBalanceForRentExemption,
    ).toHaveBeenCalledExactlyOnceWith(0, 'confirmed')
  })

  test('a missing ATA has zero token balance', async () => {
    const rpc = connectionFor(null)
    await expect(
      readSolanaBalances(rpc.connection, owner),
    ).resolves.toMatchObject({ usdc: 0n, ata })
    expect(rpc.getAccountInfo).toHaveBeenCalledExactlyOnceWith(ata, 'confirmed')
  })

  test.each([
    ['mint', { mint: Keypair.generate().publicKey }],
    ['owner', { owner: Keypair.generate().publicKey }],
    ['frozen', { state: AccountState.Frozen }],
    ['uninitialized', { state: AccountState.Uninitialized }],
  ] as const)('rejects %s mismatch', async (_name, overrides) => {
    const rpc = connectionFor(tokenInfo(overrides))
    await expect(readSolanaBalances(rpc.connection, owner)).rejects.toThrow(
      'USDC token account ownership/state mismatch',
    )
    expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1)
  })

  test('rejects an account owned by the wrong program', async () => {
    const rpc = connectionFor({
      ...tokenInfo(),
      owner: SystemProgram.programId,
    })
    await expect(
      readSolanaBalances(rpc.connection, owner),
    ).rejects.toBeInstanceOf(TokenInvalidAccountOwnerError)
  })

  test('rejects malformed token account data', async () => {
    const rpc = connectionFor({
      ...tokenInfo(),
      data: Buffer.alloc(AccountLayout.span - 1),
    })
    await expect(
      readSolanaBalances(rpc.connection, owner),
    ).rejects.toBeInstanceOf(TokenInvalidAccountSizeError)
  })

  test('uses the fetched snapshot even if a second fetch would find the ATA missing', async () => {
    const rpc = connectionFor(null)
    rpc.getAccountInfo.mockResolvedValueOnce(tokenInfo())
    await expect(
      readSolanaBalances(rpc.connection, owner),
    ).resolves.toMatchObject({ usdc: 9_007_199_254_740_993n })
    expect(rpc.getAccountInfo).toHaveBeenCalledTimes(1)

    // The old getAccount path fetched again instead of decoding the snapshot.
    const oldRpc = connectionFor(null)
    oldRpc.getAccountInfo.mockResolvedValueOnce(tokenInfo())
    expect(
      await oldRpc.connection.getAccountInfo(ata, 'confirmed'),
    ).not.toBeNull()
    await expect(
      getAccount(oldRpc.connection, ata, 'confirmed'),
    ).rejects.toBeInstanceOf(TokenAccountNotFoundError)
    expect(oldRpc.getAccountInfo).toHaveBeenCalledTimes(2)
  })
})
