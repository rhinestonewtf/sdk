import { type Address, decodeFunctionData, parseAbi } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import { RhinestoneSDK } from '..'
import { resolveCalls } from '../calls/resolve'
import { toEvmChainReference } from '../chains/caip2'
import type { CallInput, OwnableValidatorConfig } from '../config/account'
import {
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
} from '../modules/validators/multi-factor'
import {
  changeThreshold,
  disable,
  enable,
  removeSubValidator,
  setSubValidator,
} from './mfa'

const accountAddress = '0xc02C600Bd93e6C86aE2Ed1D418B87Fe225171E74'

const rpcReadContract = vi.hoisted(() =>
  vi
    .fn()
    .mockResolvedValue([
      [
        '0x0000007261E4E2F1a892A58fd0708c9321e76020',
        '0xf6bdf42c9be18ceca5c06c42a43daf7fbbe7896b',
      ],
      '0x0000000000000000000000000000000000000001',
    ]),
)

vi.mock('../clients/rpc/compatibility', () => ({
  materializeRpcReader: () => ({
    chain: { kind: 'evm', id: base.id, caip2: `eip155:${base.id}` },
    rpc: {
      getCode: vi.fn(),
      getTransactionCount: vi.fn(),
      readContract: rpcReadContract,
      multicall: vi.fn(),
    },
  }),
}))

const moduleActionAbi = parseAbi([
  'function installModule(uint256 moduleTypeId, address module, bytes initData)',
  'function uninstallModule(uint256 moduleTypeId, address module, bytes deInitData)',
])
const managementActionAbi = parseAbi([
  'function setThreshold(uint8 threshold)',
  'function setValidator(address validatorAddress, bytes12 validatorId, bytes newValidatorData)',
  'function removeValidator(address validatorAddress, bytes12 validatorId)',
])

async function resolveCallInputs(calls: readonly CallInput[], config: unknown) {
  return resolveCalls(calls as never, {
    account: accountAddress,
    chain: toEvmChainReference(base.id),
    config: config as never,
  })
}

async function accountConfig() {
  const sdk = new RhinestoneSDK({ apiKey: 'test' })
  return (
    await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
  ).config
}

const factor: OwnableValidatorConfig = {
  type: 'ecdsa',
  accounts: [accountA],
}

const moduleCases = [
  {
    name: 'legacy default',
    argument: undefined,
    expected: MULTI_FACTOR_VALIDATOR_ADDRESS,
  },
  {
    name: 'registry-free override',
    argument: MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
    expected: MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
  },
] as const

function expectModuleArgument(data: `0x${string}`, expected: Address) {
  const decoded = decodeFunctionData({ abi: moduleActionAbi, data })
  expect(decoded.args[1].toLowerCase()).toBe(expected.toLowerCase())
}

function expectSingleEvmCall(
  calls: Awaited<ReturnType<typeof resolveCallInputs>>,
) {
  expect(calls).toHaveLength(1)
  const call = calls[0]
  if (!call || !('to' in call) || !call.data) {
    throw new Error('Expected one EVM calldata call')
  }
  return call
}

function managementFunctionName(data?: `0x${string}`) {
  if (!data) throw new Error('Expected management calldata')
  return decodeFunctionData({ abi: managementActionAbi, data }).functionName
}

describe('MFA actions', () => {
  test.each(moduleCases)(
    'installs the $name module',
    async ({ argument, expected }) => {
      const calls = await resolveCallInputs(
        [enable([factor], 1, argument)],
        await accountConfig(),
      )

      const call = expectSingleEvmCall(calls)
      expect(call.to).toBe(accountAddress)
      expectModuleArgument(call.data, expected)
    },
  )

  test.each(moduleCases)(
    'uninstalls the $name module',
    async ({ argument, expected }) => {
      const calls = await resolveCallInputs(
        [disable(argument)],
        await accountConfig(),
      )

      const call = expectSingleEvmCall(calls)
      expect(call.to).toBe(accountAddress)
      expectModuleArgument(call.data, expected)
    },
  )

  test.each(moduleCases)(
    'targets the $name module for management calls',
    ({ argument, expected }) => {
      const calls = [
        changeThreshold(2, argument),
        setSubValidator(1, factor, argument),
        removeSubValidator(1, factor, argument),
      ]

      expect(calls.map(({ to }) => to)).toEqual([expected, expected, expected])
      expect(calls.map(({ data }) => managementFunctionName(data))).toEqual([
        'setThreshold',
        'setValidator',
        'removeValidator',
      ])
    },
  )
})
