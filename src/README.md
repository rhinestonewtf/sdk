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

### Quick Start

You'll need a Rhinestone API key, as well as an existing account with some testnet tokens.

You can get some testnet USDC using a [Circle Faucet](https://faucet.circle.com). Make sure you have the testnet ETH on the source chain as well.

## Creating a Wallet

Let's create a single-owner Safe account:

```ts
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

import { createRhinestoneAccount } from './index'

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

const fundingAccount = privateKeyToAccount(fundingPrivateKey as Hex)
const publicClient = createPublicClient({
  chain: sourceChain,
  transport: http(),
})
const fundingClient = createWalletClient({
  account: fundingAccount,
  chain: sourceChain,
  transport: http(),
})

// You can use an existing PK here
const privateKey = generatePrivateKey()
console.log('pk', privateKey)
const account = privateKeyToAccount(privateKey)

const rhinestoneAccount = await createRhinestoneAccount({
  account: {
    type: 'safe',
  },
  validators: [
    {
      type: 'ecdsa',
      account,
    },
  ],
  rhinestoneApiKey,
  deployerAccount: fundingAccount,
})
const address = await rhinestoneAccount.getAddress(sourceChain)
console.log(address)
```

## Funding the Account

We will send some tokens from the funding account to the Safe account.

```ts
const usdc = getTokenAddress(sourceChain)
const usdcTarget = getTokenAddress(targetChain)
const usdcAmount = 1n

const ethBalance = await publicClient.getBalance({
  address,
})
if (ethBalance < parseEther('0.001')) {
  const txHash = await fundingClient.sendTransaction({
    to: address,
    value: parseEther('0.001'),
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })
}

const usdcBalance = await publicClient.readContract({
  address: usdcSource,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [address],
})
if (usdcBalance < usdcAmount) {
  const txHash2 = await fundingClient.sendTransaction({
    to: usdcSource,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [address, usdcAmount],
    }),
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash2 })
}

function getTokenAddress(chain: Chain) {
  switch (chain.id) {
    case baseSepolia.id:
      return '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
    case arbitrumSepolia.id:
      return '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
    case optimismSepolia.id:
      return '0x5fd84259d66Cd46123540766Be93DFE6D43130D7'
    default:
      throw new Error('Unsupported chain')
  }
}
```

## Sending a Cross-chain Transaction

Finally, let's make a cross-chain token transfer:

```ts
const bundleId = await rhinestoneAccount.sendTransactions({
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
})
console.log('id', bundleId)

const bundleResult = await rhinestoneAccount.waitForExecution({ id: bundleId })
console.log('status', bundleResult.status)
```

## Contributing

For feature or change requests, feel free to open a PR, start a discussion or get in touch with us.
