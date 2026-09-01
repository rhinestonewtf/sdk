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
import { resolveSwapScope } from '../../../src/modules/validators/smart-sessions/swap/scope'
import {
  resolveZeroExSettler,
  ZEROX_ALLOWANCE_HOLDER,
} from '../../../src/modules/validators/smart-sessions/swap/zero-ex'
import {
  getSessionData,
  swapperZeroEx,
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
 *   PLASMA_SWAP_ENABLED=true \
 *   INTEGRATION_RHINESTONE_API_KEY=<prod key> \
 *   PLASMA_SWAP_PRIVATE_KEY=0x...  # stable owner key, required
 *   PLASMA_USDC_ADDRESS=0x...      # USDC on Plasma
 *   bun run test:integration -- plasma-swap
 *
 * The owner key is required rather than generated: a fresh key would derive a
 * different account address each run, so every re-run would strand the balance
 * you funded the previous one with. Run it once to learn the smart account
 * address, fund that address, then re-run with the same key.
 */

const PLASMA_USDT0: Address = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'

// How much NEW USDC each run must acquire. `tokenRequests` names a target
// balance, not a delta: request an amount the account already holds and the
// orchestrator answers ALREADY_FUNDED and plans no swap at all. So every
// request is computed as `current balance + this`, which keeps the scenario
// re-runnable and — critically — keeps the adversarial test honest, since a
// short-circuited plan would pass a spend assertion without spending anything.
const BUY_DELTA = 5_000n // 0.005 USDC (6dp)
// Sell-side balance the account must already hold. Small on purpose: real funds.
const MIN_SELL_BALANCE = 10_000n // 0.01 USDT0 (6dp)
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

/**
 * The account owner key. Required — deliberately never generated here.
 *
 * Generating one per run would derive a different account address every time,
 * so each re-run would strand the previously funded balance in an account
 * nothing references again. The key has to be stable and operator-owned.
 */
function ownerAccount() {
  const key = process.env.PLASMA_SWAP_PRIVATE_KEY
  if (!key) {
    throw new Error(
      'PLASMA_SWAP_PRIVATE_KEY is required. This scenario spends real funds, ' +
        'and a generated key would produce a new account address on every ' +
        'run — stranding whatever you funded the last one with.\n' +
        '  Generate once:  cast wallet new\n' +
        '  Then set PLASMA_SWAP_PRIVATE_KEY and re-run; the test prints the ' +
        'smart account address to fund.',
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('PLASMA_SWAP_PRIVATE_KEY must be a 0x 32-byte hex key')
  }
  return privateKeyToAccount(key as `0x${string}`)
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
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()

      log('account', address)
      log('owner', owner.address)

      // --- Discovery -----------------------------------------------------------
      // Everything below is logged before any assertion, so a failing run still
      // tells us what the orchestrator actually wanted to do.

      const settler = await resolveZeroExSettler(plasmaClient())
      log('0x settler (ownerOf(2))', settler)
      log('0x allowance holder', ZEROX_ALLOWANCE_HOLDER)

      const usdc = plasmaUsdc()
      log('plasma USDC', usdc)

      const usdcBefore = await erc20Balance(usdc, address)
      const buyTarget = usdcBefore + BUY_DELTA
      log('USDC before', usdcBefore)
      log('requesting USDC target', buyTarget)

      const balance = await erc20Balance(PLASMA_USDT0, address)
      log('USDT0 balance', `${formatUnits(balance, 6)} (raw ${balance})`)
      if (balance < MIN_SELL_BALANCE) {
        throw new Error(
          `Fund ${address} with at least ${formatUnits(MIN_SELL_BALANCE, 6)} USDT0 ` +
            'on Plasma, then re-run with the same PLASMA_SWAP_PRIVATE_KEY. ' +
            'The address is derived from that key, so it is stable across runs.',
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
          // Swapper-routed AND the calls[] tail pinned to 0x. This is the
          // strongest available scoping: the account may only call the Swapper,
          // and the Swapper may only route through 0x's AllowanceHolder.
          via: [swapperZeroEx()],
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
          tokenRequests: [{ address: usdc, amount: buyTarget }],
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          // Sponsored so the orchestrator's fee / gas-refund plumbing ops
          // (an extra approve plus `callbackAllowMaxAmount`) are not charged to
          // the account. Those ops are authorised by the wildcard
          // intent-execution fallback, which a restricted session drops — so a
          // scoped session can only execute an intent whose op set contains
          // nothing but its own authorised calls.
          sponsored: true,
          signers: { type: 'session' as const, session },
        }),
      })

      logPlannedOps(execution)
      log('execution phase', execution.phase)
      if (execution.phase !== 'success') {
        const err = (execution as { error?: unknown }).error as
          | { code?: string; message?: string; details?: unknown }
          | undefined
        log('error code', err?.code)
        log('error message', err?.message)
        log(
          'error details',
          JSON.stringify(err?.details ?? null)?.slice(0, 2500),
        )
      }
      expectOutcome(execution, { kind: 'success' })

      const usdcAfter = await erc20Balance(usdc, address)
      log(
        'USDC balance after',
        `${formatUnits(usdcAfter, 6)} (raw ${usdcAfter})`,
      )
      expect(usdcAfter).toBeGreaterThanOrEqual(buyTarget)
    })
  })

/**
 * The ops the orchestrator actually planned. A restricted session executes only
 * ops whose (target, selector) it lists, so this is the other half of the
 * comparison — without it a rejection tells you nothing about WHICH op was
 * unauthorised.
 */
function logPlannedOps(execution: unknown) {
  const signData = (
    execution as { prepared?: { quotes?: { best?: { signData?: unknown } } } }
  )?.prepared?.quotes?.best?.signData as Record<string, unknown> | undefined
  log('signData keys', signData ? Object.keys(signData) : 'none')
  const collect = (v: unknown): { to: string; data: string }[] => {
    const entries = Array.isArray(v) ? v : v ? [v] : []
    return entries.flatMap(
      (e) =>
        ((e as { message?: { op?: { ops?: unknown[] } } })?.message?.op
          ?.ops as { to: string; data: string }[]) ?? [],
    )
  }
  for (const key of Object.keys(signData ?? {})) {
    const found = collect(signData?.[key])
    if (found.length) {
      log(
        `signData.${key} ops`,
        found.map((o) => ({ to: o.to, selector: o.data?.slice(0, 10) })),
      )
    }
  }
  const ops = collect(signData?.origin)
  if (!ops?.length) {
    log('planned ops', 'none found on the quote')
    return
  }
  log(
    'planned ops',
    ops.map((o) => ({ to: o.to, selector: o.data?.slice(0, 10) })),
  )
  // Full calldata is long but is what pinpoints an argument-pin mismatch.
  if (process.env.SDK_ITEST_DEBUG === 'true') {
    for (const [i, o] of ops.entries()) log(`op[${i}] data`, o.data)
  }
}

function logAuthorisedActions(session: Session) {
  log(
    'session authorises',
    getSessionData(session).actions.map((a) => ({
      target: a.actionTarget,
      selector: a.actionTargetSelector,
    })),
  )
}

async function withEnableData<
  T extends { signers: { type: 'session'; session: Session } },
>(account: RhinestoneAccount, session: Session, transaction: T) {
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

/**
 * Adversarial: does the session's cumulative cap actually bound spend?
 *
 * The happy-path run settled through Rhinestone's Swapper on the filler side,
 * with the account's sell token leaving via the claim/compact path rather than
 * through a scoped action. That path does not go through `checkAction`, and
 * `restrictToActions` drops the fallback where the spending-limit guardrails
 * live — so the cap may bound nothing on this route. This asserts it does.
 */
describe
  .runIf(enabled)
  .sequential('plasma swap session boundaries (RHI-6286)', () => {
    test('a swap needing more than the session cap is rejected', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()
      const usdc = plasmaUsdc()
      const settler = await resolveZeroExSettler(plasmaClient())

      const before = await erc20Balance(PLASMA_USDT0, address)
      const usdcBefore = await erc20Balance(usdc, address)
      // Two false-pass traps to avoid here. Request at-or-below the current
      // balance and the orchestrator answers ALREADY_FUNDED, planning nothing.
      // Request more than the account can fund and it fails for insufficient
      // balance. Either way the spend assertion passes without the cap ever
      // being consulted. So: a small delta the account can comfortably afford,
      // with a cap far below its cost.
      const buyTarget = usdcBefore + BUY_DELTA
      log('USDT0 before', before)
      log('requesting USDC target', `${buyTarget} (holds ${usdcBefore})`)

      // A cap far below what the swap costs (the happy path spent ~25_069).
      const TINY_CAP = 1_000n // 0.001 USDT0
      const sessionKey = privateKeyToAccount(generatePrivateKey())
      const session: Session = toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [sessionKey] },
        swap: {
          sell: { token: PLASMA_USDT0, maxTotal: TINY_CAP },
          buy: { token: usdc },
          to: address,
          via: [zeroEx({ settler })],
        },
      })
      log('session cap', TINY_CAP)

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/overspend',
        transaction: await withEnableData(account, session, {
          chain: plasma,
          tokenRequests: [{ address: usdc, amount: buyTarget }],
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          signers: { type: 'session' as const, session },
        }),
      })

      log('overspend execution phase', execution.phase)
      log(
        'overspend execution detail',
        JSON.stringify(
          execution,
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        )?.slice(0, 4000),
      )
      if (execution.phase === 'success') {
        log('OVERSPEND SUCCEEDED — cap not enforced on this route', execution)
      }

      const after = await erc20Balance(PLASMA_USDT0, address)
      const spent = before - after
      log('USDT0 after', after)
      log('spent vs cap', `${spent} spent, cap was ${TINY_CAP}`)

      // The whole point of the cap. If this fails, the session is unbounded on
      // the claim/compact route and the scoping is cosmetic there.
      expect(spent).toBeLessThanOrEqual(TINY_CAP)
    })
  })

/**
 * Adversarial: can a swap-scoped session send funds to someone other than the
 * account? The session pins `to: account.address`, so this must be refused.
 *
 * Uses the OWNER EOA as the third party rather than a random address: it is
 * outside the session's pinned recipient, so it is a genuine test, but anything
 * that does leak is still recoverable by the operator.
 */
describe
  .runIf(enabled)
  .sequential('plasma swap session recipient binding (RHI-6286)', () => {
    test('cannot deliver funds to an unpinned recipient', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()
      const usdc = plasmaUsdc()
      const settler = await resolveZeroExSettler(plasmaClient())

      const before = await erc20Balance(PLASMA_USDT0, address)
      const outsiderBefore = await erc20Balance(PLASMA_USDT0, owner.address)
      log('account USDT0 before', before)
      log('outsider USDT0 before', outsiderBefore)

      const sessionKey = privateKeyToAccount(generatePrivateKey())
      const session: Session = toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [sessionKey] },
        swap: {
          sell: { token: PLASMA_USDT0, maxTotal: SESSION_CAP },
          buy: { token: usdc },
          // The session says output must come back to the account.
          to: address,
          via: [zeroEx({ settler })],
        },
      })

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/wrong-recipient',
        transaction: await withEnableData(account, session, {
          chain: plasma,
          // ...but the intent asks for the SELL token, delivered elsewhere.
          // Nothing about this is a USDT0 -> USDC swap to the account.
          tokenRequests: [{ address: PLASMA_USDT0, amount: 10_000n }],
          recipient: owner.address,
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          signers: { type: 'session' as const, session },
        }),
      })

      log('wrong-recipient phase', execution.phase)
      const outsiderAfter = await erc20Balance(PLASMA_USDT0, owner.address)
      const leaked = outsiderAfter - outsiderBefore
      log('leaked to outsider', leaked)
      if (leaked > 0n) {
        log('SESSION DID NOT BIND RECIPIENT', {
          leaked,
          detail: JSON.stringify(execution, (_k, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          )?.slice(0, 1500),
        })
      }
      expect(leaked).toBe(0n)
    })
  })

/**
 * Control experiment: is the session in the validation path at all?
 *
 * Same intent as the recipient test, but the session is NEVER enabled and no
 * enableData is attached. If this still executes, the session is not being
 * validated and the earlier violations say nothing about session enforcement —
 * they would just mean the SDK signed with something else.
 */
describe
  .runIf(enabled)
  .sequential('plasma session is actually in the path (RHI-6286)', () => {
    test('an unenabled session with no enableData cannot execute', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()
      const usdc = plasmaUsdc()
      const settler = await resolveZeroExSettler(plasmaClient())

      const outsiderBefore = await erc20Balance(PLASMA_USDT0, owner.address)

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
      log('session enabled?', await account.isSessionEnabled(session))

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/unenabled-session',
        // NOTE: no withEnableData wrapper — deliberately unenabled.
        transaction: {
          chain: plasma,
          tokenRequests: [{ address: PLASMA_USDT0, amount: 10_000n }],
          recipient: owner.address,
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          signers: { type: 'session' as const, session },
        },
      })

      log('unenabled-session phase', execution.phase)
      const leaked =
        (await erc20Balance(PLASMA_USDT0, owner.address)) - outsiderBefore
      log('leaked with unenabled session', leaked)
      if (leaked > 0n) {
        log('SESSION NOT IN VALIDATION PATH — unenabled session executed', {
          leaked,
        })
      }
      expect(leaked).toBe(0n)
    })
  })

/**
 * Control: the SAME sponsored swap, but with a session that KEEPS the wildcard
 * intent-execution fallback (no `swap`, no `restrictToActions`).
 *
 * Separates "the action set doesn't match" from "a restricted session cannot
 * satisfy this path at all". The restricted run's ops were all individually
 * authorised — pinned spender, pinned tokens, pinned recipient, amount under
 * cap — and still failed. If this unrestricted twin succeeds on identical ops,
 * the restriction itself is the blocker.
 */
describe
  .runIf(enabled)
  .sequential('plasma unrestricted session control (RHI-6286)', () => {
    test('an unrestricted session executes the same sponsored swap', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()
      const usdc = plasmaUsdc()

      const usdcBefore = await erc20Balance(usdc, address)
      const buyTarget = usdcBefore + BUY_DELTA
      log('USDC before', usdcBefore)

      const sessionKey = privateKeyToAccount(generatePrivateKey())
      // No `swap`, no `restrictToActions` — keeps the intent-execution fallback.
      const session: Session = toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [sessionKey] },
      })

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/unrestricted-control',
        transaction: await withEnableData(account, session, {
          chain: plasma,
          tokenRequests: [{ address: usdc, amount: buyTarget }],
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          sponsored: true,
          signers: { type: 'session' as const, session },
        }),
      })

      log('unrestricted control phase', execution.phase)
      const err = (execution as { error?: { message?: string } }).error
      if (err) log('unrestricted control error', err.message)

      const usdcAfter = await erc20Balance(usdc, address)
      log('USDC after', usdcAfter)
      expect(usdcAfter).toBeGreaterThanOrEqual(buyTarget)
    })
  })

/**
 * Does the ARG policy bind, or only the (target, selector) allowlist?
 *
 * The earlier recipient test asked for a plain token transfer, so it was
 * rejected for having no matching action at all — it never reached the argument
 * rules. This asks for a genuine Swapper swap whose ONLY deviation is the
 * recipient argument: same target, same selector, same tokens, amount under
 * cap. If it is refused, the UniversalActionPolicy rule on `recipient`@160 is
 * doing the work.
 */
describe
  .runIf(enabled)
  .sequential('plasma swap arg-policy binding (RHI-6286)', () => {
    test('a Swapper swap delivering to an unpinned recipient is refused', async () => {
      const owner = ownerAccount()
      const account = await createSwapAccount(owner)
      const address = await account.getAddress()
      const usdc = plasmaUsdc()

      const outsiderBefore = await erc20Balance(usdc, owner.address)
      const outsiderUsdcTarget = outsiderBefore + BUY_DELTA
      log('outsider USDC before', outsiderBefore)

      const sessionKey = privateKeyToAccount(generatePrivateKey())
      const session: Session = toSession({
        chain: plasma,
        owners: { type: 'ecdsa', accounts: [sessionKey] },
        swap: {
          sell: { token: PLASMA_USDT0, maxTotal: SESSION_CAP },
          buy: { token: usdc },
          // Pinned to the ACCOUNT...
          to: address,
        },
      })

      const execution = await executeIntent({
        account,
        label: 'plasma-swap/arg-policy-recipient',
        transaction: await withEnableData(account, session, {
          chain: plasma,
          // ...but the swap is asked to deliver USDC to the owner EOA instead.
          // Everything else — target, selector, tokens, amount — is compliant.
          tokenRequests: [{ address: usdc, amount: outsiderUsdcTarget }],
          recipient: owner.address,
          sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
          sponsored: true,
          signers: { type: 'session' as const, session },
        }),
      })

      logPlannedOps(execution)
      log('arg-policy recipient phase', execution.phase)
      const err = (execution as { error?: { message?: string } }).error
      if (err) log('arg-policy recipient error', err.message)

      const leaked = (await erc20Balance(usdc, owner.address)) - outsiderBefore
      log('USDC leaked to outsider', leaked)
      expect(leaked).toBe(0n)
    })
  })

/**
 * Invariants of the pinned Swapper route, tested against real intents.
 *
 * The compliant swap succeeding proves the pins MATCH production calldata. It
 * does not prove they BIND — an inert rule would also let it through. So each
 * case here keeps the real 0x route and corrupts one pinned word, via the
 * public raw-`actions` passthrough. A rule that binds turns the
 * previously-succeeding swap into an on-chain rejection.
 *
 * Every case is expected to fail, so they cost nothing but gas-free simulation.
 */
type TamperedRule = { calldataOffset: bigint; referenceValue: unknown }

/** Rebuild the scoped session with one pinned word replaced. */
function tamperedSession(
  args: {
    sellToken: Address
    buyToken: Address
    recipient: Address
    sessionKey: ReturnType<typeof privateKeyToAccount>
  },
  offset: bigint,
  replacement: unknown,
) {
  const { permissions, actions } = resolveSwapScope(
    {
      sell: { token: args.sellToken, maxTotal: SESSION_CAP },
      buy: { token: args.buyToken },
      to: args.recipient,
      via: [swapperZeroEx()],
    },
    plasma.id,
  )
  const tampered = actions.map((action) => ({
    ...action,
    policies: action.policies?.map((policy) =>
      policy.type === 'universal-action'
        ? {
            ...policy,
            rules: policy.rules.map((rule: TamperedRule) =>
              rule.calldataOffset === offset
                ? { ...rule, referenceValue: replacement }
                : rule,
            ),
          }
        : policy,
    ),
  }))
  return toSession({
    chain: plasma,
    owners: { type: 'ecdsa', accounts: [args.sessionKey] },
    // The internal (loose) shapes are what `resolveSwapScope` emits; the public
    // config type is the ABI-inferred one, so a cast is unavoidable here.
    // biome-ignore lint/suspicious/noExplicitAny: internal shapes, corrupted on purpose
    permissions: permissions as any,
    // biome-ignore lint/suspicious/noExplicitAny: deliberately corrupted rules
    actions: tampered as any,
    restrictToActions: true,
  })
}

describe
  .runIf(enabled)
  .sequential('plasma swapper route invariants (RHI-6286)', () => {
    const cases: { name: string; offset: bigint; replacement: unknown }[] = [
      {
        name: 'calls[1].target pinned to a non-0x aggregator',
        offset: 576n,
        replacement: '0x000000000000000000000000000000000000dEaD' as Address,
      },
      {
        name: 'calls[] length pinned to 3 instead of 2',
        offset: 256n,
        replacement: 3n,
      },
      {
        name: 'calls[] array pointer pinned to a wrong position',
        offset: 224n,
        replacement: 288n,
      },
      {
        name: 'calls[0].target pinned to a token that is not the sell token',
        offset: 352n,
        replacement: '0x000000000000000000000000000000000000dEaD' as Address,
      },
      {
        name: 'head tokenIn pinned to the wrong token',
        offset: 0n,
        replacement: '0x000000000000000000000000000000000000dEaD' as Address,
      },
      {
        name: 'head tokenOut pinned to the wrong token',
        offset: 64n,
        replacement: '0x000000000000000000000000000000000000dEaD' as Address,
      },
      {
        name: 'head recipient pinned to someone other than the account',
        offset: 160n,
        replacement: '0x000000000000000000000000000000000000dEaD' as Address,
      },
    ]

    for (const { name, offset, replacement } of cases) {
      test(`rejects when ${name}`, async () => {
        const owner = ownerAccount()
        const account = await createSwapAccount(owner)
        const address = await account.getAddress()
        const usdc = plasmaUsdc()

        const before = await erc20Balance(PLASMA_USDT0, address)
        const usdcBefore = await erc20Balance(usdc, address)

        const session = tamperedSession(
          {
            sellToken: PLASMA_USDT0,
            buyToken: usdc,
            recipient: address,
            sessionKey: privateKeyToAccount(generatePrivateKey()),
          },
          offset,
          replacement,
        )

        const execution = await executeIntent({
          account,
          label: `plasma-swap/invariant/${offset}`,
          transaction: await withEnableData(account, session, {
            chain: plasma,
            tokenRequests: [{ address: usdc, amount: usdcBefore + BUY_DELTA }],
            sourceAssets: { [plasma.id]: [PLASMA_USDT0] },
            sponsored: true,
            signers: { type: 'session' as const, session },
          }),
        })

        log(`invariant@${offset} phase`, execution.phase)
        const spent = before - (await erc20Balance(PLASMA_USDT0, address))
        log(`invariant@${offset} spent`, spent)
        // The identical session with a CORRECT pin executes this same swap, so
        // a rejection here is the pinned word doing the work.
        expect(execution.phase).not.toBe('success')
        expect(spent).toBe(0n)
      })
    }
  })
