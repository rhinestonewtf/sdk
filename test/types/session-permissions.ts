import { type Address, erc20Abi } from 'viem'
import { base } from 'viem/chains'
import type {
  Permission,
  Permit2ClaimPolicy,
  SessionSigning,
  SessionSigningContent,
} from '../../src/index'
import { toSession } from '../../src/smart-sessions/index'
import { accountA } from '../consts'

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
            amount: { condition: 'lessThan', value: 1000n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error recipient is an address param, not a bigint.
            recipient: { condition: 'equal', value: 1000n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error amount is a uint256 param, not an address.
            amount: { condition: 'lessThan', value: RECIPIENT },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        // @ts-expect-error mint is not in the ERC-20 ABI.
        mint: {},
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error sender is not a transfer parameter.
            sender: { condition: 'equal', value: RECIPIENT },
          },
        },
      },
    },
  ],
})

const bytesAbi = [
  {
    type: 'function',
    name: 'send',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: bytesAbi,
      address: USDC,
      functions: {
        send: {
          params: {
            // @ts-expect-error dynamic bytes params cannot be constrained.
            data: { condition: 'equal', value: '0x1234' },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          // @ts-expect-error raw policies were removed from permission configs.
          policies: [{ type: 'usage-limit', limit: 1n }],
        },
      },
    },
  ],
})

const permission = {
  abi: erc20Abi,
  address: USDC,
  functions: {
    approve: {
      params: {
        spender: { condition: 'equal', value: RECIPIENT },
        amount: { condition: 'lessThanOrEqual', value: 1000n },
      },
    },
  },
} as const satisfies Permission<typeof erc20Abi>

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [permission],
})

const permit2ClaimPolicy = {
  type: 'permit2',
  spenders: [RECIPIENT],
  sourceTokens: [{ chain: base, address: USDC }],
  destinationTokens: [{ chain: base, address: RECIPIENT }],
  recipients: [{ chain: base, address: 'any' }],
  recipientIsAccount: true,
  permitDeadline: { min: 1n, max: 2n },
  fillDeadline: [{ chain: base, min: 3n, max: 4n }],
} as const satisfies Permit2ClaimPolicy

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  claimPolicies: [permit2ClaimPolicy],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  claimPolicies: [
    {
      // @ts-expect-error public Permit2 claim policies use `permit2`.
      type: 'permit2-claim',
    },
  ],
})

const signingContent = {
  domain: { name: 'Permit2', chainId: base.id, verifyingContract: USDC },
  types: {
    Permit: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
} as const satisfies SessionSigningContent

const scopedSigning = {
  mode: 'scoped',
  allowedContents: [signingContent],
  validUntil: new Date('2030-01-01'),
} as const satisfies SessionSigning

for (const signing of [
  { mode: 'disabled' } as const,
  { mode: 'unrestricted', validAfter: new Date(0) } as const,
  scopedSigning,
]) {
  toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    permissions: [permission],
    signing,
  })
}

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  // @ts-expect-error disabled signing cannot define a validity window.
  signing: { mode: 'disabled', validUntil: new Date() },
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  // @ts-expect-error unsupported signing mode.
  signing: { mode: 'all' },
})

// --- Array-typed params are unaddressable by a 32-byte ref comparison --------
// `uint256[]` used to match the `uint${string}` branch of AbiTypeToValue and be
// typed `bigint`, so this compiled and only blew up at runtime.

const arrayParamAbi = [
  {
    type: 'function',
    name: 'batch',
    inputs: [
      { name: 'amounts', type: 'uint256[]' },
      { name: 'fixedAmounts', type: 'uint256[3]' },
      { name: 'recipients', type: 'address[]' },
      { name: 'selectors', type: 'bytes4[]' },
      { name: 'total', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: arrayParamAbi,
      address: USDC,
      functions: {
        batch: {
          params: {
            // @ts-expect-error dynamic uint256[] cannot be constrained.
            amounts: { condition: 'equal', value: 1n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: arrayParamAbi,
      address: USDC,
      functions: {
        batch: {
          params: {
            // @ts-expect-error fixed-size uint256[3] spans three words.
            fixedAmounts: { condition: 'equal', value: 1n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: arrayParamAbi,
      address: USDC,
      functions: {
        batch: {
          params: {
            // @ts-expect-error address[] cannot be constrained.
            recipients: { condition: 'equal', value: USDC },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: arrayParamAbi,
      address: USDC,
      functions: {
        batch: {
          params: {
            // @ts-expect-error bytes4[] cannot be constrained.
            selectors: { condition: 'equal', value: '0x12345678' },
          },
        },
      },
    },
  ],
})

// The scalar sibling on the same ABI must still be constrainable — proves the
// array rejection is targeted, not a blanket failure of the whole function.
toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: arrayParamAbi,
      address: USDC,
      functions: {
        batch: { params: { total: { condition: 'lessThan', value: 1000n } } },
      },
    },
  ],
})

// --- `inRange` needs two bounds, so it is not a single-value condition -------

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error inRange cannot be expressed with a single value.
            amount: { condition: 'inRange', value: 1000n },
          },
        },
      },
    },
  ],
})

// The supported spelling: inclusive bounds.
toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: { params: { amount: { min: 1n, max: 1000n } } },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error bounds must match the param's Solidity type.
            amount: { min: 1n, max: USDC },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error bounds and a single-value condition are exclusive.
            amount: { condition: 'lessThan', value: 5n, min: 1n, max: 10n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error bounds and anyOf are exclusive.
            amount: { anyOf: [1n, 2n], min: 1n, max: 10n },
          },
        },
      },
    },
  ],
})
