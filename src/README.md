# Rhinestone SDK

> End-to-end chain abstraction and modularity toolkit

Rhinestone is a vertically integrated smart wallet and crosschain liquidity platform. The SDK provides a unified interface for deploying and managing self-custodial smart accounts, powered by an intent-based transaction infrastructure that enables seamless crosschain execution without bridging or gas tokens.

The platform combines modular [smart account tooling](https://docs.rhinestone.dev/smart-wallet/core/create-account) with an intent engine ([Warp](https://docs.rhinestone.dev/home/introduction/rhinestone-intents)) that aggregates settlement layers through a unified relayer market. This handles routing, token liquidity, and crosschain orchestration across all [supported chains](https://docs.rhinestone.dev/home/resources/supported-chains).

[Documentation](https://docs.rhinestone.dev)

## Features


- **Crosschain Transactions** - Execute transactions on any target chain using assets from any source chain. The orchestrator handles routing and settlement. [Learn more](https://docs.rhinestone.dev/smart-wallet/chain-abstraction/multi-chain-intent)

- **Swaps** - Token exchanges via solver-based swaps or injected DEX aggregator swaps, integrated into crosschain transaction execution. [Learn more](https://docs.rhinestone.dev/smart-wallet/chain-abstraction/swaps)

- **Passkeys** - WebAuthn-based authentication for smart accounts, replacing seed phrases with device biometrics. [Learn more](https://docs.rhinestone.dev/smart-wallet/core/passkeys)

- **Smart Sessions** - Onchain permissions system for scoped transaction automation, enabling one-click UX and server-side execution with granular policies. [Learn more](https://docs.rhinestone.dev/smart-wallet/smart-sessions/overview)

- **Gas Sponsorship** - Subsidize gas, bridge, and swap fees for users by depositing USDC on Base. Applies across all supported chains. [Learn more](https://docs.rhinestone.dev/smart-wallet/gas-sponsorship/overview)

## Installation

```bash
npm install viem @rhinestone/sdk@v1-latest
```

```bash
bun install viem @rhinestone/sdk@v1-latest
```

This README covers legacy **v1**. Unqualified installation selects another SDK generation. **1.23.0 is the upcoming, intentionally breaking legacy-v1 minor release**, to be published under `v1-latest`; it is not yet a published release in this checkout. After publication, you can pin `@rhinestone/sdk@1.23.0`. Existing caret ranges may adopt this breaking minor automatically: review the migration below before upgrading.

## Migrating v1 to Blanc (upcoming 1.23.0)

High-level transaction preparation, signing and submission now use `2026-04.blanc`: `POST /quotes` creates a stored quote and `POST /intents` submits it by intent ID. Reads also use Blanc. High-level method inputs remain unchanged, but **returned prepared/signed types are source-breaking**. UserOperation APIs are separate and unchanged.

### Prepared data and costs

| Before (Alps) | After (Blanc) |
| --- | --- |
| `prepared.intentRoute` / `signed.intentRoute` | `prepared.quote` / `signed.quote` |
| `prepared.intentRoute.intentCost` | `prepared.quote.cost` (new shape, not an alias) |
| Locally reconstructed bundle payloads | Served `quote.signData`; `account.getTransactionMessages(prepared)` returns origin/destination payloads |
| `prepared.intentRoute.tokenRequirements` | `prepared.quote.tokenRequirements` (EOA accounts only) |

`PreparedTransactionData` still contains `transaction` and `intentInput`; `SignedTransactionData` retains its signature fields. The quote exposes `intentId`, `expiresAt` (Unix seconds), `estimatedFillTime.seconds`, `settlementLayer`, `signData`, `cost` and optional `tokenRequirements`.

Using the `account` and transaction input from the quickstart:

```ts
const prepared = await account.prepareTransaction({
  sourceChains: [baseSepolia],
  targetChain: arbitrumSepolia,
  calls: [],
  tokenRequests: [{ address: 'USDC', amount }],
})
const { quote } = prepared
const debited = quote.cost.input
const delivered = quote.cost.output
const totalFeesUsd = quote.cost.fees.total.usd
const gasFee = quote.cost.fees.breakdown.gas
// gasFee.usd is the full cost; gasFee.sponsored identifies who pays.
const messages = account.getTransactionMessages(prepared)
const signed = await account.signTransaction(prepared)
const transaction = await account.submitTransaction(signed)
```

`cost.input` and `cost.output` contain token amounts as bigints, chain IDs, token addresses, and nullable symbol/decimals/USD price metadata. `fees.total.usd` is the total fee cost, not necessarily the user's bill. Each breakdown category (`gas`, `bridge`, `swap`, `app`, `protocol`, `sponsorSurcharge`) reports the **full** USD cost and a separate `sponsored` flag; sponsored costs are not zeroed. Do not alias these to Alps cost fields or reconstruct the old public cost shape. EOA approval/wrap/permit requirements also use bigint amounts.

Re-prepare and re-sign persisted pre-migration transactions. Do not replay old prepared/signed objects, cast Alps bundles to `Quote`, or reuse old authorization as a Blanc quote. Submit before `quote.expiresAt`; if it expires, obtain and sign a fresh quote.

### Signing and compatibility

The server chooses the signing payload shape; there is no client opt-out. Sign served EIP-712 payloads instead of rebuilding them from bundles. The SDK reuses a signature when origin and destination share a payload. Chain-independent ECDSA/multisig and passkey owners support MultiChainOps without a domain chain; smart sessions, quorum owners and Startale K1 reject payloads spanning multiple chains during preparation. EIP-7702 authorization covers all required leg chains plus the target (unless a recipient is supplied), skipping existing delegation.

CCTP delivery into the sender's own account now uses Rhinestone's relayer. Signature count depends on the served route/payload; do not assume every CCTP route adds one signature. Crosschain destination calls can use bridges other than Across. Sessions no longer produce unused target-execution signatures on IntentExecutor routes where the server neither serves nor reads one; `quote.signData.targetExecution` remains optional.

`feeAsset` and `lockFunds` remain accepted for source compatibility but have no effect on Blanc intent fees or locking; the server never implemented their legacy options. This does **not** deprecate standalone Compact deposit/withdrawal actions or generic allowance helpers.

Existing exports remain available. Deprecated `Orchestrator.getIntentRoute` and `Orchestrator.submitIntent` still use Alps, including its submission-time approval. New low-level flows use `createQuote` / `createIntent`, or the high-level prepare/sign/submit methods. Alps route/bundle/cost types, bundle-derived Compact/Permit2/singleChainOps payload builders, and bundle-based Permit2 signing helpers are retained for compatibility, not for signing Blanc quotes. No Alps retirement date is promised.

The actual low-level import is:

```ts
import { Orchestrator } from '@rhinestone/sdk/dist/src/orchestrator'
import type { Quote, QuoteCost } from '@rhinestone/sdk/dist/src/orchestrator/types'
```

`@rhinestone/sdk/orchestrator` is not an exported subpath. Retained deep helper entry points are `@rhinestone/sdk/dist/src/execution/compact`, `@rhinestone/sdk/dist/src/execution/permit2` and `@rhinestone/sdk/dist/src/execution/singleChainOps`. Standalone Compact actions use `@rhinestone/sdk/actions/compact`; JWT helpers use `@rhinestone/sdk/jwt-server`.

### Authentication, reads and errors

**JWT clients and signing backends must upgrade together**, with explicit `apiVersion: 'blanc'` on the backend; see all three helper configurations below. Existing callback inputs are preserved, not replaced with Blanc wire bodies.

Read result types and existing error classes remain unchanged. Server validation wording and field paths may differ (for example, unsupported-token chains use CAIP-2). Trace IDs come from response headers where readable, with a body fallback. Cross-origin browsers require the API to expose those headers; browser-header compatibility must be deployed before release. This migration adds no public envelope-code field or error classes.

## Authentication

The SDK supports two authentication modes: **API key** and **JWT**.

### API Key

Pass the API key from the [Rhinestone dashboard](https://dashboard.rhinestone.dev):

```ts
const rhinestone = new RhinestoneSDK({
  auth: {
    mode: 'apiKey',
    apiKey: 'your-api-key',
  },
})
```

### JWT (Experimental)

JWT authentication uses RS256-signed tokens for fine-grained access control. There are two integration patterns depending on your architecture:

#### Sponsorship approval and upgrades

For Blanc, approval is requested during preparation/quotation, before wallet signing, only when at least one sponsorship category is enabled. Submission uses ordinary access authentication: do not request or resend an extension there. The callback remains optional; without it, the server decides whether the request can proceed and may return a user-paid route. Inspect `quote.cost.fees.breakdown` sponsorship flags rather than assuming sponsorship. Approval denial and callback errors propagate without an automatic unsponsored retry.

**Upgrade both client and signing-backend SDK installations together, and set `apiVersion: 'blanc'` on the signing backend.** This opt-in is mandatory for Blanc with `createJwtSigner`, `createExtensionTokenHandler` (Web), and `createExpressRouter`. They default to `apiVersion: 'alps'`, preserving the raw callback digest used by legacy Alps `submitIntent` approval. With `'blanc'`, the signer normalizes the legacy v1 input to Blanc's quote-binding contract internally. Pass-through callbacks, endpoint payloads and sponsorship-filter inputs stay unchanged: callbacks still receive legacy numeric-chain/serialized-amount inputs.

For Blanc, custom signers that previously hashed the raw callback input must instead use `computeBlancIntentInputDigest` from `@rhinestone/sdk/jwt-server`. Pass it the unchanged legacy callback input, not raw JCS or a Blanc wire request. The existing `computeIntentInputDigest` remains a generic hash helper and does not perform this normalization.

Every quote attempt needs a fresh extension/JTI. An extension may be consumed even if quote planning subsequently fails; never cache or replay it for retries. Filters still inspect only destination chain, account and calls: binding the other request fields cryptographically does not add application-policy checks for them.

#### Client-server (SDK runs in browser/client)

When the SDK runs on the client and a separate backend holds the signing key, fetch tokens via HTTP:

```ts
const rhinestone = new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: async () => {
      const res = await fetch('/api/auth/access-token')
      const { token } = await res.json()
      return token
    },
    // Only needed for sponsored intents:
    getIntentExtensionToken: async (intentInput) => {
      const res = await fetch('/api/auth/extension-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentInput }),
      })
      const { token } = await res.json()
      return token
    },
  },
})
```

Your backend is responsible for signing JWTs with the correct claims. Install the optional `jose` peer dependency for the server helpers (and `express` for the Express adapter). Configure the same Blanc opt-in for Web or Express helpers:

```ts
import {
  createAccessTokenHandler,
  createExtensionTokenHandler,
  createExpressRouter,
  type JwtHandlerConfig,
} from '@rhinestone/sdk/jwt-server'

const config: JwtHandlerConfig = {
  apiVersion: 'blanc',
  jwt: {
    privateKey: myJwk,
    integratorId: 'int_abc',
    projectId: 'proj_xyz',
    appId: 'app_prod',
    keyId: 'key_1',
  },
}

// Web Request/Response handlers:
const accessHandler = createAccessTokenHandler(config)
const extensionHandler = createExtensionTokenHandler(config)
// Alternatively, mount the Express router at /api/auth with express.json():
const router = createExpressRouter(config)
```

Protect token endpoints with your application's authentication and sponsorship policy. See the [JWT documentation](https://docs.rhinestone.dev) for the required token format.

#### Same-host (SDK and signing key on the same server)

When the SDK runs server-side with access to the private key, use `createJwtSigner` to sign tokens in-process without an HTTP round-trip:

```ts
import { createJwtSigner } from '@rhinestone/sdk/jwt-server'

const signer = createJwtSigner({
  apiVersion: 'blanc',
  jwt: {
    privateKey: myJwk, // RS256 private key in JWK format
    integratorId: 'int_abc',
    projectId: 'proj_xyz',
    appId: 'app_prod',
    keyId: 'key_1',
  },
})

const rhinestone = new RhinestoneSDK({
  auth: { mode: 'experimental_jwt', ...signer },
})
```

`createJwtSigner` returns `{ accessToken, getIntentExtensionToken }` — the same shape as the `auth` config, so you can spread it directly. It handles all claim structure, key caching, and intent digest computation internally.

To control which intents your backend sponsors, pass `shouldSponsor` filters. The signer checks them before signing — denied requests throw a `SponsorshipDeniedError`:

```ts
import { createJwtSigner } from '@rhinestone/sdk/jwt-server'

const signer = createJwtSigner({
  apiVersion: 'blanc',
  jwt: jwtCredentials,
  shouldSponsor: {
    chain: ({ id }) => [1, 8453, 10].includes(id),
    account: async (address) => isUser(address),
  },
})
```

## Quickstart

Create a smart account:

```ts
import { RhinestoneSDK } from '@rhinestone/sdk'

const rhinestone = new RhinestoneSDK({ apiKey: 'your-api-key' })
const account = await rhinestone.createAccount({
  owners: {
    type: 'ecdsa',
    accounts: [signer],
  },
})
```

Send a crosschain transaction:

```ts
const transaction = await account.sendTransaction({
  sourceChains: [baseSepolia],
  targetChain: arbitrumSepolia,
  calls: [
    {
      to: 'USDC',
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipient, amount],
      }),
    },
  ],
  tokenRequests: [{ address: 'USDC', amount }],
})

const result = await account.waitForExecution(transaction)
```

For a complete walkthrough, see the [Quickstart guide](https://docs.rhinestone.dev/smart-wallet/quickstart).

## Migrating from Orchestrator SDK

To migrate from the [Orchestrator SDK](https://github.com/rhinestonewtf/orchestrator-sdk), use the low-level entry point `@rhinestone/sdk/dist/src/orchestrator` and review individual exports/types. Retained Alps methods do not become Blanc methods by changing the import; use the v1 migration guide above for new quote-based flows.

Let us know if you encounter any issues!

## Contributing

For feature or change requests, feel free to open a PR, start a discussion or get in touch with us.
