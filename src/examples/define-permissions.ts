/**
 * Example: Using definePermissions with complex, multi-param functions
 *
 * Shows how param-level rules (universal-action policy) work on functions
 * with many static arguments — not just simple ERC-20 transfers.
 */
import type { Address } from 'viem'
import { base } from 'viem/chains'
import { definePermissions } from '../actions/permissions'
import type { Session } from '../types'

// -- Constants ----------------------------------------------------------------

const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WETH: Address = '0x4200000000000000000000000000000000000006'
const TREASURY: Address = '0x000000000000000000000000000000000000dead'
const POOL: Address = '0x0000000000000000000000000000000000000042'
const LENDING_POOL: Address = '0x0000000000000000000000000000000000C0FFEE'

// -- ABIs ---------------------------------------------------------------------

// A lending protocol with complex multi-arg functions
const lendingPoolAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'asset', type: 'address' }, // which token to deposit
      { name: 'amount', type: 'uint256' }, // how much
      { name: 'onBehalfOf', type: 'address' }, // credit goes to
      { name: 'referralCode', type: 'uint16' }, // referral tracking
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'borrow',
    inputs: [
      { name: 'asset', type: 'address' }, // token to borrow
      { name: 'amount', type: 'uint256' }, // how much
      { name: 'interestRateMode', type: 'uint256' }, // 1=stable, 2=variable
      { name: 'referralCode', type: 'uint16' }, // referral tracking
      { name: 'onBehalfOf', type: 'address' }, // who takes the debt
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'repay',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'liquidationCall',
    inputs: [
      { name: 'collateralAsset', type: 'address' },
      { name: 'debtAsset', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'debtToCover', type: 'uint256' },
      { name: 'receiveAToken', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// -- Permissions --------------------------------------------------------------

const now = Date.now()
const ONE_DAY = 24 * 60 * 60 * 1000

// 1) Lending pool: deposit, borrow, repay, liquidate — each with param rules
//
//    Every `params` block generates a universal-action policy. The helper
//    computes calldataOffset from the parameter's position in the ABI:
//      index 0 → offset 0    (bytes 0–31)
//      index 1 → offset 32   (bytes 32–63)
//      index 2 → offset 64   (bytes 64–95)
//      index 3 → offset 96   (bytes 96–127)
//      index 4 → offset 128  (bytes 128–159)
//
const lendingActions = definePermissions({
  abi: lendingPoolAbi,
  address: LENDING_POOL,
  functions: {
    // deposit: only USDC, only to our own account, max 50k per call
    deposit: {
      policies: [
        { type: 'usage-limit', limit: 100n },
        { type: 'time-frame', validAfter: now, validUntil: now + ONE_DAY },
      ],
      // Generates a universal-action policy with 3 rules:
      //   rule 0: calldata[0:32]  == USDC       (asset must be USDC)
      //   rule 1: calldata[32:64] <= 50k        (amount capped)
      //   rule 2: calldata[64:96] == TREASURY   (credit goes to treasury)
      params: {
        asset: { condition: 'equal', value: USDC },
        amount: { condition: 'lessThanOrEqual', value: 50_000n * 10n ** 6n },
        onBehalfOf: { condition: 'equal', value: TREASURY },
      },
    },

    // borrow: only WETH, variable rate only, max 10 WETH, debt to treasury
    borrow: {
      policies: [{ type: 'usage-limit', limit: 10n }],
      // Generates a universal-action policy with 4 rules across 5 params:
      //   rule 0: calldata[0:32]   == WETH       (borrow WETH only)
      //   rule 1: calldata[32:64]  <= 10 ETH     (max borrow amount)
      //   rule 2: calldata[64:96]  == 2          (variable rate mode)
      //   rule 3: calldata[128:160] == TREASURY  (debt assigned to treasury)
      //
      // Note: referralCode (index 3, offset 96) is skipped — no constraint.
      // Only params you list get rules. The rest are unconstrained.
      params: {
        asset: { condition: 'equal', value: WETH },
        amount: { condition: 'lessThanOrEqual', value: 10n * 10n ** 18n },
        interestRateMode: { condition: 'equal', value: 2n },
        onBehalfOf: { condition: 'equal', value: TREASURY },
      },
    },

    // repay: allow repaying any amount of USDC, variable rate, for treasury
    repay: {
      policies: [{ type: 'usage-limit', limit: 50n }],
      params: {
        asset: { condition: 'equal', value: USDC },
        interestRateMode: { condition: 'equal', value: 2n },
        onBehalfOf: { condition: 'equal', value: TREASURY },
      },
    },

    // liquidationCall: lock down all 5 params
    //   - only liquidate WETH collateral / USDC debt
    //   - only for a specific user (the pool)
    //   - max 5k USDC debt coverage per call
    //   - must receive aTokens (not underlying)
    liquidationCall: {
      policies: [
        { type: 'usage-limit', limit: 5n },
        { type: 'time-frame', validAfter: now, validUntil: now + ONE_DAY },
      ],
      // All 5 params constrained:
      //   calldata[0:32]   == WETH   (collateralAsset)
      //   calldata[32:64]  == USDC   (debtAsset)
      //   calldata[64:96]  == POOL   (user to liquidate)
      //   calldata[96:128] <= 5000e6 (debtToCover)
      //   calldata[128:160] == true  (receiveAToken)
      params: {
        collateralAsset: { condition: 'equal', value: WETH },
        debtAsset: { condition: 'equal', value: USDC },
        user: { condition: 'equal', value: POOL },
        debtToCover: {
          condition: 'lessThanOrEqual',
          value: 5_000n * 10n ** 6n,
        },
        receiveAToken: { condition: 'equal', value: true },
      },
    },
  },
})

// 2) Token approvals for the lending pool
const tokenActions = definePermissions({
  abi: erc20Abi,
  address: USDC,
  functions: {
    approve: {
      policies: [{ type: 'usage-limit', limit: 5n }],
      params: {
        spender: { condition: 'equal', value: LENDING_POOL },
        amount: { condition: 'lessThanOrEqual', value: 50_000n * 10n ** 6n },
      },
    },
  },
})

// -- Session definition -------------------------------------------------------

// The session key holder — a separate ECDSA key with limited permissions
const sessionKeyAccount = {} as any // in practice: privateKeyToAccount('0x...')

const session: Session = {
  chain: base,
  owners: {
    type: 'ecdsa',
    accounts: [sessionKeyAccount],
    threshold: 1,
  },
  actions: [...lendingActions, ...tokenActions],
}

// Result: 5 scoped actions, each with a universal-action policy generated
// from params, plus additional policies (usage-limit, time-frame) stacked on.
//
// What the session key can do:
//   1. deposit(USDC, ≤50k, to=treasury, any referral)      — 100 calls, 24h
//   2. borrow(WETH, ≤10, variable rate, to=treasury)       — 10 calls
//   3. repay(USDC, any amount, variable rate, for=treasury) — 50 calls
//   4. liquidationCall(WETH/USDC, pool, ≤5k, aTokens)      — 5 calls, 24h
//   5. approve(USDC, spender=lending pool, ≤50k)            — 5 calls

// -- Enable session on the smart session emissary -----------------------------

async function enableSession() {
  // 1. Create the account with smart sessions enabled
  const { createRhinestoneAccount } = await import('../index')

  const account = await createRhinestoneAccount({
    apiKey: 'YOUR_API_KEY',
    owners: {
      type: 'ecdsa',
      accounts: [sessionKeyAccount], // the account owner
      threshold: 1,
    },
    experimental_sessions: { enabled: true },
  })

  // 2. Prepare the session for signing — computes EIP-712 typed data
  //    and fetches nonces from the on-chain emissary
  const details = await account.experimental_getSessionDetails([session])

  // 3. Owner signs the session — this authorizes the session key to act
  //    within the defined permissions
  const signature = await account.experimental_signEnableSession(details)

  // 4. Submit a transaction that enables the session on-chain.
  //    The emissary stores the permission config so it can verify
  //    future calls from the session key.
  const { experimental_enableSession } = await import(
    '../actions/smart-sessions'
  )

  await account.sendTransaction({
    chain: base,
    calls: [
      experimental_enableSession(
        session,
        signature,
        details.hashesAndChainIds,
        0,
      ),
    ],
  })

  // 5. Now the session key can execute scoped transactions.
  //    The session key holder signs with their own key, and the emissary
  //    validates each call against the stored permissions + policies.
  await account.sendTransaction({
    chain: base,
    calls: [
      {
        to: LENDING_POOL,
        data: '0x...', // encoded deposit(USDC, 10000e6, treasury, 0)
      },
    ],
    signers: {
      type: 'experimental_session',
      session,
      enableData: {
        userSignature: signature,
        hashesAndChainIds: details.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
      verifyExecutions: true,
    },
  })
}

void enableSession
