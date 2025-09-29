# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit

## Usage

### Installation

```bash
npm install viem @rhinestone/sdk
```

```bash
pnpm install viem @rhinestone/sdk
```

```bash
yarn add viem @rhinestone/sdk
```

```bash
bun install viem @rhinestone/sdk
```

## Quickstart

You'll need a Rhinestone API key, as well as an existing account with some testnet ETH on the source chain.

### SDK Initialization

To initialize the SDK with your configuration:

```ts
import { RhinestoneSDK } from '@rhinestone/sdk'

const sdk = new RhinestoneSDK({
  apiKey: 'your-rhinestone-api-key',
  // Optional: Provider configuration
  provider: {
    type: 'alchemy',
    apiKey: 'your-alchemy-api-key',
  },
  // Optional: Bundler configuration
  bundler: {
    // the bundler settings
  },
  // Optional: Paymaster configuration
  paymaster: {
    // the paymaster settings
  },
})
```

### Creating a Wallet

Let's create a smart account with a single owner:

```ts
import { RhinestoneSDK } from '@rhinestone/sdk'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, arbitrumSepolia, optimismSepolia } from 'viem/chains'
import {
  Chain,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  Hex,
  http,
  parseEther,
} from 'viem'

const fundingPrivateKey = process.env.FUNDING_PRIVATE_KEY
if (!fundingPrivateKey) {
  throw new Error('FUNDING_PRIVATE_KEY is not set')
}

const rhinestoneApiKey = process.env.RHINESTONE_API_KEY
if (!rhinestoneApiKey) {
  throw new Error('RHINESTONE_API_KEY is not set')
}

const sourceChain = baseSepolia
const targetChain = arbitrumSepolia

// You can use an existing PK here
const privateKey = generatePrivateKey()
console.info(`Owner private key: ${privateKey}`)
const account = privateKeyToAccount(privateKey)

// Initialize the SDK
const sdk = new RhinestoneSDK({
  apiKey: rhinestoneApiKey,
})

// Create the Rhinestone account
const rhinestoneAccount = await sdk.createAccount({
  owners: {
    type: 'ecdsa',
    accounts: [account],
  },
})
const address = await rhinestoneAccount.getAddress()
console.info(`Smart account address: ${address}`)
```

### Funding the Account

We will send some ETH from the funding account to the created smart account. The Orchestrator will use some of that ETH to deploy the account on the target chain, as well as to convert it to USDC for a transfer transaction.

```ts
const publicClient = createPublicClient({
  chain: sourceChain,
  transport: http(),
});
const fundingAccount = privateKeyToAccount(fundingPrivateKey as Hex);
const fundingClient = createWalletClient({
  account: fundingAccount,
  chain: sourceChain,
  transport: http(),
});

const txHash = await fundingClient.sendTransaction({
  to: address,
  value: parseEther('0.001'),
});
await publicClient.waitForTransactionReceipt({ hash: txHash });
```

### Sending a Cross-chain Transaction

Finally, let's make a cross-chain token transfer:

```ts
const usdcTarget = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
const usdcAmount = 1n;

const transaction = await rhinestoneAccount.sendTransaction({
  sourceChain,
  targetChain,
  calls: [
    {
      to: usdcTarget,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: ['0xd8da6bf26964af9d7eed9e03e53415d37aa96045', usdcAmount],
      }),
    },
  ],
  tokenRequests: [
    {
      address: usdcTarget,
      amount: usdcAmount,
    },
  ],
});
console.info('Transaction', transaction);

const transactionResult = await rhinestoneAccount.waitForExecution(transaction);
console.info('Result', transactionResult);
```

After running that, you will get a smart account deployed on both Base Sepolia and Arbitrum Sepolia, and make a cross-chain USDC transfer.

### Using Smart Sessions

First, define a session you want to use:

```ts
const session: Session = {
  owners: {
    type: 'ecdsa',
    accounts: [sessionOwner],
  },
  actions: [
    {
      target: wethAddress,
      selector: toFunctionSelector(
        getAbiItem({
          abi: wethAbi,
          name: 'deposit',
        }),
      ),
    },
    {
      target: wethAddress,
      selector: toFunctionSelector(
        getAbiItem({
          abi: wethAbi,
          name: 'transfer',
        }),
      ),
      policies: [
        {
          type: 'universal-action',
          rules: [
            {
              condition: 'equal',
              calldataOffset: 0n,
              referenceValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            },
          ],
        },
      ],
    },
  ],
}
```

During account initialization, provide the session you've just created. Make sure to also provide a bundler configuration.

```ts
// Initialize the SDK with bundler configuration
const sdk = new RhinestoneSDK({
  apiKey: rhinestoneApiKey,
  bundler: {
    // bundler configuration
  },
})

const rhinestoneAccount = await sdk.createAccount({
  owners: {
    type: 'ecdsa',
    accounts: [account],
  },
  sessions: [session],
})
```

When making a transaction, specify the `signers` object to sign it with the session key:

```ts
const transactionResult = await rhinestoneAccount.sendTransaction({
  // …
  signers: {
    type: 'session',
    session: session,
  },
})
```

## Migrating from Orchestrator SDK

To migrate from the [Orchestrator SDK](https://github.com/rhinestonewtf/orchestrator-sdk), replace all imports of `@rhinestone/orchestrator-sdk` with `@rhinestone/sdk/orchestrator`.

Let us know if you encounter any issues!

## Contributing

For feature or change requests, feel free to open a PR, start a discussion or get in touch with us.
