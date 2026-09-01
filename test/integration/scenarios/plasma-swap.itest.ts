import {
  type Address,
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { plasma } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import type { RhinestoneAccount, Session } from '../../../src/index'
import {
  resolveZeroExSettler,
  ZEROX_ALLOWANCE_HOLDER,
} from '../../../src/modules/validators/smart-sessions/swap/zero-ex'
import {
  getSessionData,
  toSession,
  zeroEx,
} from '../../../src/smart-sessions/index'
import { createIntegrationSDK } from '../config/environment'
import { executeIntent, expectOutcome } from '../framework/runner'

/**
 * RHI-6286 — live Plasma swap through a venue-scoped smart session.
 *
 * Runs against the PRODUCTION orchestrator and production contracts, on a fresh
 * account the operator funds by hand. It is deliberately not part of the smoke
 * suite: it needs real USDT0 and a human in the loop.
 *
 *   INTEGRATION_RHINESTONE_API_KEY=<prod key> \
 *   PLASMA_SWAP_PRIVATE_KEY=0x...            # optional, reuse a funded account
 *   bun run test:integration -- plasma-swap
 *
 * Without `PLASMA_SWAP_PRIVATE_KEY` the test generates a key, prints the address
 * and the key, and fails with instructions — fund it and re-run with the key set
 * so the same account is reused.
 */

const PLASMA_USDT0: Address = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'

// Amount to swap. Small on purpose: this spends real funds.
const SWAP_AMOUNT = 100_000n // 0.1 USDT0 (6dp)
// Cumulative session cap. Above the swap amount so one swap fits, low enough
// that a bug cannot drain the funded account.
const SESSION_CAP = 1_000_000n // 1 USDT0

function log(label: string, value: unknown) {
  console.log(`[plasma-swap] ${label}:`, value)
}

function plasmaClient() {
  return createPublicClient({ chain: plasma, transport: http() })
}

/**
 * Plasma's USDC address.
 *
 * Not discoverable from the orchestrator: `GET /chains` collapses swap-quoter
 * chains to `supportedTokens: 'all'` rather than listing addresses (see
 * `clients/orchestrator/chain-catalog.ts`). And the SDK bundles no token
 * registry. So it has to be supplied.
 */
function plasmaUsdc(): Address {
  const address = process.env.PLASMA_USDC_ADDRESS
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(
      'PLASMA_USDC_ADDRESS must be set to USDC on Plasma (9745). The ' +
        'orchestrator does not expose it: /chains reports supportedTokens ' +
        "'all' for swap-quoter chains.",
    )
  }
  return address as Address
}

async function erc20Balance(token: Address, owner: Address): Promise<bigint> {
  return plasmaClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

function ownerAccount() {
  const key = process.env.PLASMA_SWAP_PRIVATE_KEY
  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('PLASMA_SWAP_PRIVATE_KEY must be a 0x 32-byte hex key')
    }
    return { account: privateKeyToAccount(key as `0x${string}`), fresh: false }
  }
  const generated = generatePrivateKey()
  return {
    account: privateKeyToAccount(generated),
    fresh: true,
    key: generated,
  }
}

/** Nexus + ownable validator, sessions enabled — the deposit-service shape. */
function createSwapAccount(owner: ReturnType<typeof privateKeyToAccount>) {
  return createIntegrationSDK().createAccount({
    account: { type: 'nexus' },
    owners: { type: 'ecdsa', accounts: [owner] },
    sessions: { enabled: true },
  })
}

// Opt-in only. This spends real mainnet funds on a human-funded account, so it
// must never run as part of `bun run test:integration`.
const enabled = process.env.PLASMA_SWAP_ENABLED === 'true'

describe
  .runIf(enabled)
  .sequential('SDK integration plasma swap session (RHI-6286)', () => {
    test('scopes a session to a 0x USDT0 -> USDC swap and executes it', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner.account)
      const address = await account.getAddress()

      log('account', address)
      log('owner', owner.account.address)

      if (owner.fresh) {
        log('generated key (set PLASMA_SWAP_PRIVATE_KEY to reuse)', owner.key)
      }

      // --- Discovery -----------------------------------------------------------
      // Everything below is logged before any assertion, so a failing run still
      // tells us what the orchestrator actually wanted to do.

      const settler = await resolveZeroExSettler(plasmaClient())
      log('0x settler (ownerOf(2))', settler)
      log('0x allowance holder', ZEROX_ALLOWANCE_HOLDER)

      const usdc = plasmaUsdc()
      log('plasma USDC', usdc)

      const balance = await erc20Balance(PLASMA_USDT0, address)
      log('USDT0 balance', `${formatUnits(balance, 6)} (raw ${balance})`)
      if (balance < SWAP_AMOUNT) {
        throw new Error(
          `Fund ${address} with at least ${formatUnits(SWAP_AMOUNT, 6)} USDT0 ` +
            `on Plasma, then re-run with PLASMA_SWAP_PRIVATE_KEY set.`,
        )
      }

      // --- The session ---------------------------------------------------------

      const sessionKey = privateKeyToAccount(generatePrivateKey())
      const session: Session = toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [sessionKey] },
        swap: {
          sell: { token: PLASMA_USDT0, maxTotal: SESSION_CAP },
          buy: { token: usdc },
          to: address,
          via: [zeroEx({ settler })],
        },
      })

      // What the session authorises. Compare against the ops logged below: a
      // restricted session only executes ops whose (target, selector) it lists.
      logAuthorisedActions(session)

      // --- Execute -------------------------------------------------------------

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/0x/usdt0-to-usdc',
        transaction: await withEnableData(account, session, {
          chain: plasma,
          tokenRequests: [{ address: usdc, amount: SWAP_AMOUNT }],
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          signers: { session },
        }),
      })

      log('execution phase', execution.phase)
      if (execution.phase !== 'success') {
        log('execution detail', execution)
      }
      expectOutcome(execution, { kind: 'success' })

      const usdcAfter = await erc20Balance(usdc, address)
      log(
        'USDC balance after',
        `${formatUnits(usdcAfter, 6)} (raw ${usdcAfter})`,
      )
      expect(usdcAfter).toBeGreaterThan(0n)
    })
  })

function logAuthorisedActions(session: Session) {
  log(
    'session authorises',
    getSessionData(session).actions.map((a) => ({
      target: a.actionTarget,
      selector: a.actionTargetSelector,
    })),
  )
}

async function withEnableData(
  account: RhinestoneAccount,
  session: Session,
  // biome-ignore lint/suspicious/noExplicitAny: transaction shape varies by route
  transaction: any,
) {
  const details = await account.getSessionDetails([session])
  const enableSignature = await account.signEnableSession(details)
  return {
    ...transaction,
    signers: {
      ...transaction.signers,
      enableData: {
        userSignature: enableSignature,
        hashesAndChainIds: details.hashesAndChainIds,
        sessionToEnableIndex: 0,
      },
    },
  }
}
