import type { Chain } from 'viem/chains'
import { expect } from 'vitest'
import type { RhinestoneAccount } from '../../../src/index'

export async function expectDeployed(
  account: RhinestoneAccount,
  chain: Chain,
): Promise<void> {
  expect(
    await account.isDeployed(chain),
    `${account.getAddress()} should be deployed on ${chain.name} (${chain.id})`,
  ).toBe(true)
}

export async function expectNotDeployed(
  account: RhinestoneAccount,
  chain: Chain,
): Promise<void> {
  expect(
    await account.isDeployed(chain),
    `${account.getAddress()} should not be deployed on ${chain.name} (${chain.id})`,
  ).toBe(false)
}
