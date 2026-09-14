import {
  type BridgeFill,
  type EvmAccountConfig,
  RhinestoneSDK,
  solanaAddress,
  solanaMainnet,
} from '@rhinestone/sdk'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

function readEcoIntentHash(bridgeFill: BridgeFill): Hex | undefined {
  if (bridgeFill.type !== 'ECO') return undefined
  return bridgeFill.intentHash
}

const ecoBridgeFill = {
  type: 'ECO',
  destinationChainId: mainnet.id,
  intentHash: `0x${'11'.repeat(32)}`,
} as const satisfies BridgeFill
const ecoIntentHash: Hex | undefined = readEcoIntentHash(ecoBridgeFill)

const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const evm = {
  owners: { type: 'ecdsa', accounts: [owner] },
} satisfies EvmAccountConfig
const solana = solanaAddress('11111111111111111111111111111111')
const sdk = new RhinestoneSDK({ apiKey: 'contract' })

async function useCurrentAccountApi() {
  const account = await sdk.createAccount({ evm, solana: { address: solana } })
  account.getAddress('evm')
  account.getAddress('solana')
  await account.prepareTransaction({
    sourceChains: [mainnet],
    targetChain: solanaMainnet,
    tokenRequests: [{ address: solana, amount: 1n }],
  })

  const receiver = await sdk.createAccount({ solana: { address: solana } })
  receiver.getAddress('solana')
  // @ts-expect-error receiver-only handles cannot transact
  receiver.prepareTransaction({})
  // @ts-expect-error the legacy flat constructor is intentionally removed
  sdk.createAccount(evm)
  // @ts-expect-error VM selection is required
  account.getAddress()
}

void ecoIntentHash
void useCurrentAccountApi
