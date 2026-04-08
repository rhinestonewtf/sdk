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

The SDK supports two authentication modes: **API key** (default) and **JWT**.

### API Key

```ts
const rhinestone = new RhinestoneSDK({ apiKey: 'your-api-key' })
```

### JWT

For JWT authentication, provide an access token (static or async getter) and an optional callback for signing intent extension tokens (required for sponsored intents):

```ts
const rhinestone = new RhinestoneSDK({
  auth: {
    mode: 'jwt',
    accessToken: async () => fetchTokenFromBackend(),
    getIntentExtensionToken: async (intentInput) => fetchExtensionToken(intentInput),
  },
})
```

#### Same-host signing (no HTTP round-trip)

If your SDK and JWT signing logic run on the same server, use `createJwtSigner` to handle token creation in-process:

```ts
import { createJwtSigner } from '@rhinestone/sdk/jwt-server'

const signer = createJwtSigner({
  privateKey: myJwk, // RS256 JWK (private key)
  integratorId: 'int_abc',
  projectId: 'proj_xyz',
  appId: 'app_prod',
  keyId: 'key_1',
})

const rhinestone = new RhinestoneSDK({
  auth: { mode: 'jwt', ...signer },
})
```

Generate a keypair for JWT signing:

```bash
bun run scripts/generate-jwt-keypair.ts --kid key_1
```

See [`examples/jwt-server/`](examples/jwt-server/) for a full client + server example.

## Quickstart

Create a smart account:

```ts
import { RhinestoneSDK } from '@rhinestone/sdk'

const rhinestone = new RhinestoneSDK()
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
