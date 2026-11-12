import { P256, PublicKey, Signature, WebAuthnP256 } from 'ox'
import {
  type Address,
  type Hex,
  hashMessage,
  hashTypedData,
  keccak256,
  type LocalAccount,
  type SignableMessage,
  type TypedDataDefinition,
  toFunctionSelector,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia, baseSepolia, optimismSepolia } from 'viem/chains'
import { recordingAccount } from '../signers'

// Funded fixtures use their own label-derived keys, never the seed keys in
// test/consts.ts: the seed account must stay unfunded. These keys are public
// and guard only testnet dust; a drained fixture shows up in the preflight.
function fixtureKey(label: string): Hex {
  return keccak256(toHex(`sdk-v1-parity:${label}:v1`))
}

const FIXTURE_SIGNER_LABELS = [
  'owner',
  'owner2',
  'owner3',
  'session',
  'eoa',
] as const

type FixtureSignerLabel = (typeof FIXTURE_SIGNER_LABELS)[number]

const FIXTURE_SIGNERS = Object.fromEntries(
  FIXTURE_SIGNER_LABELS.map((label) => [
    label,
    privateKeyToAccount(fixtureKey(label)),
  ]),
) as Record<FixtureSignerLabel, LocalAccount>

function fixtureSigner(label: FixtureSignerLabel): LocalAccount {
  return recordingAccount(FIXTURE_SIGNERS[label], label)
}

const PASSKEY_ID = 'sdk-v1-parity-passkey'
const PASSKEY_RP_ID = 'parity.rhinestone.test'
const PASSKEY_ORIGIN = 'https://parity.rhinestone.test'
const passkeyPrivateKey = fixtureKey('passkey')
const PASSKEY_PUBLIC_KEY = PublicKey.toHex(
  P256.getPublicKey({ privateKey: passkeyPrivateKey }),
  { includePrefix: false },
)

// A software WebAuthn credential: same assertion format as a browser passkey,
// with deterministic (RFC 6979) P-256 signatures.
async function signPasskeyHash({ hash }: { hash: Hex }) {
  const { payload, metadata } = WebAuthnP256.getSignPayload({
    challenge: hash,
    rpId: PASSKEY_RP_ID,
    origin: PASSKEY_ORIGIN,
  })
  const signature = P256.sign({
    payload,
    privateKey: passkeyPrivateKey,
    hash: true,
  })
  return { signature: Signature.toHex(signature), webauthn: metadata, raw: {} }
}

const softwarePasskey = {
  id: PASSKEY_ID,
  publicKey: PASSKEY_PUBLIC_KEY,
  type: 'webAuthn',
  sign: signPasskeyHash,
  // As viem's WebAuthn account: both sign the EIP-191 / EIP-712 hash.
  signMessage: ({ message }: { message: SignableMessage }) =>
    signPasskeyHash({ hash: hashMessage(message) }),
  signTypedData: (parameters: TypedDataDefinition) =>
    signPasskeyHash({ hash: hashTypedData(parameters) }),
} as unknown as WebAuthnAccount

function fixturePasskey(): WebAuthnAccount {
  return recordingAccount(softwarePasskey, 'passkey')
}

const NOOP_TARGET: Address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
// The target has no code, so the call succeeds and changes nothing.
const NOOP_CALL = {
  to: NOOP_TARGET,
  data: toFunctionSelector('function noop()'),
  value: 0n,
}

const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const NATIVE: Address = '0x0000000000000000000000000000000000000000'

const TOKENS = {
  [baseSepolia.id]: {
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  [arbitrumSepolia.id]: {
    USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    WETH: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
  },
  [optimismSepolia.id]: {
    USDC: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    WETH: '0x4200000000000000000000000000000000000006',
  },
} as const satisfies Record<number, Record<string, Address>>

type FundedChainId = keyof typeof TOKENS
type FixtureToken = 'USDC' | 'ETH'

const FUNDED_CHAINS = [baseSepolia, arbitrumSepolia, optimismSepolia] as const

// Names the shared testnet faucet uses for each chain.
const FAUCET_CHAIN: Record<FundedChainId, string> = {
  [baseSepolia.id]: 'base-sepolia',
  [arbitrumSepolia.id]: 'arbitrum-sepolia',
  [optimismSepolia.id]: 'optimism-sepolia',
}

function tokenAddress(chainId: FundedChainId, token: FixtureToken): Address {
  return token === 'ETH' ? NATIVE : TOKENS[chainId][token]
}

type FixtureName =
  | 'nexus-main'
  | 'safe-multisig'
  | 'kernel-passkey'
  | 'eoa'
  | 'startale'

type SessionName = 'plain' | 'scoped'

interface FixtureSpec {
  name: FixtureName
  address: Address
  description: string
  // Built per call so each build gets fresh recording signers.
  config(): Record<string, unknown>
  // Unfunded fixtures must hold nothing.
  funded: boolean
}

function sessionConfig(name: SessionName): Record<string, unknown> {
  const owners = { type: 'ecdsa', accounts: [fixtureSigner('session')] }
  switch (name) {
    case 'plain':
      return { chain: optimismSepolia, owners }
    case 'scoped':
      return {
        chain: baseSepolia,
        owners,
        actions: [
          {
            target: NOOP_TARGET,
            selector: NOOP_CALL.data,
            policies: [{ type: 'sudo' }],
          },
        ],
      }
  }
}

const SESSION_CHAIN: Record<SessionName, FundedChainId> = {
  plain: optimismSepolia.id,
  scoped: baseSepolia.id,
}

const ecdsaOwner = () => ({
  type: 'ecdsa',
  accounts: [fixtureSigner('owner')],
})

// Addresses were derived with the published 1.22.0 and funded on them; a
// config change that moves an address orphans its funds (fixtures.test.ts).
const FIXTURES: Record<FixtureName, FixtureSpec> = {
  'nexus-main': {
    name: 'nexus-main',
    address: '0xF2EF721498c691a5fCc84Adf03e8676F7fe594c3',
    description: 'Nexus, ECDSA owner, sessions enabled',
    config: () => ({
      owners: ecdsaOwner(),
      experimental_sessions: { enabled: true },
    }),
    funded: true,
  },
  'safe-multisig': {
    name: 'safe-multisig',
    address: '0xF20fC2C4f28dd5e3f94FFdaF899Ea5667Cb3ACc1',
    description: 'Safe 1.4.1, ECDSA 2-of-3',
    config: () => ({
      account: { type: 'safe' },
      owners: {
        type: 'ecdsa',
        accounts: [
          fixtureSigner('owner'),
          fixtureSigner('owner2'),
          fixtureSigner('owner3'),
        ],
        threshold: 2,
      },
    }),
    funded: true,
  },
  'kernel-passkey': {
    name: 'kernel-passkey',
    address: '0x9c5a766Ce7eb07C6227C9BFeA664841CAF28D68B',
    description: 'Kernel 3.3, software passkey owner',
    config: () => ({
      account: { type: 'kernel', version: '3.3' },
      owners: { type: 'passkey', accounts: [fixturePasskey()] },
    }),
    funded: true,
  },
  eoa: {
    name: 'eoa',
    address: '0x557A8848Fd79EBeedB6b53340C5F042A7b530E45',
    description: 'Plain EOA (USDC and ETH)',
    config: () => ({ account: { type: 'eoa' }, eoa: fixtureSigner('eoa') }),
    funded: true,
  },
  startale: {
    name: 'startale',
    address: '0x4209a72df960CB0d313Bf66eC170f6F761dF35E7',
    description: 'Startale, ECDSA owner (K1 validator, ERC-7739)',
    config: () => ({ account: { type: 'startale' }, owners: ecdsaOwner() }),
    funded: false,
  },
}

export type {
  FixtureName,
  FixtureSignerLabel,
  FixtureSpec,
  FixtureToken,
  FundedChainId,
  SessionName,
}
export {
  FAUCET_CHAIN,
  FIXTURE_SIGNERS,
  FIXTURES,
  FUNDED_CHAINS,
  fixtureKey,
  fixturePasskey,
  fixtureSigner,
  NATIVE,
  NOOP_CALL,
  NOOP_TARGET,
  PASSKEY_PUBLIC_KEY,
  PERMIT2,
  SESSION_CHAIN,
  sessionConfig,
  TOKENS,
  tokenAddress,
}
