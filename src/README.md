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
npm install viem @rhinestone/sdk
```

```bash
bun install viem @rhinestone/sdk
```

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

For Blanc, approval is requested during preparation/quotation, before wallet signing, only when at least one sponsorship category is enabled. Submission uses ordinary access authentication: do not request or resend an extension there. The callback remains optional; without it, the server decides whether the request can proceed and may return a user-paid route.

**Upgrade both client and signing-backend SDK installations together, and set `apiVersion: 'blanc'` on the signing backend.** This opt-in is mandatory for Blanc with `createJwtSigner`, `createExtensionTokenHandler` (Web), and `createExpressRouter`. They default to `apiVersion: 'alps'`, preserving the raw callback digest used by legacy Alps `submitIntent` approval. With `'blanc'`, the signer normalizes the legacy v1 input to Blanc's quote-binding contract internally. Pass-through callbacks, endpoint payloads and sponsorship-filter inputs stay unchanged.

For Blanc, custom signers that previously hashed the raw callback input must instead use `computeBlancIntentInputDigest` from `@rhinestone/sdk/jwt-server`. Pass it the unchanged legacy callback input, not a Blanc wire request. The existing `computeIntentInputDigest` remains a generic hash helper and does not perform this normalization.

Every quote attempt needs a fresh extension/JTI. An extension may be consumed even if quote planning subsequently fails; never cache or replay it for retries. Filters still inspect only destination chain, account and calls: binding the other request fields cryptographically does not add application-policy checks for them.

#### Client-server (SDK runs in browser/client)

When the SDK runs on the client and a separate backend holds the signing key, fetch tokens via HTTP:

```ts
const rhinestone = new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: async () => {
      const res = await fetch('/api/auth/token')
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

Your backend is responsible for signing JWTs with the correct claims. See the [JWT documentation](https://docs.rhinestone.dev) for the required token format.

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
  // ...
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

To migrate from the [Orchestrator SDK](https://github.com/rhinestonewtf/orchestrator-sdk), replace all imports of `@rhinestone/orchestrator-sdk` with `@rhinestone/sdk/orchestrator`.

Let us know if you encounter any issues!

## Contributing

For feature or change requests, feel free to open a PR, start a discussion or get in touch with us.
