import type { Chain } from 'viem/chains'
import { expect } from 'vitest'
import type { RhinestoneAccount, Session } from '../../../src/index'

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
    `${account.getAddress()} should not be deployed on ${chain.name} (${
      chain.id
    })`,
  ).toBe(false)
}

export async function expectSessionEnabled(
  account: RhinestoneAccount,
  session: Session,
): Promise<void> {
  const enabled = await account.experimental_isSessionEnabled(session)
  expect(enabled, `Session should be enabled on ${account.getAddress()}`).toBe(
    true,
  )
}

export async function expectSessionDisabled(
  account: RhinestoneAccount,
  session: Session,
): Promise<void> {
  const enabled = await account.experimental_isSessionEnabled(session)
  expect(enabled, `Session should be disabled on ${account.getAddress()}`).toBe(
    false,
  )
}
