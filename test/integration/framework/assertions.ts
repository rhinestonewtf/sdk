import type { Chain } from 'viem/chains'
import { expect } from 'vitest'
import type { RhinestoneAccount, Session } from '../../../src/index'

export async function expectDeployed(
  account: RhinestoneAccount,
  chain: Chain,
): Promise<void> {
  const deployed = await waitForDeployment(account, chain)
  expect(
    deployed,
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
  const enabled = await waitForSessionEnabled(account, session)
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

async function waitForDeployment(
  account: RhinestoneAccount,
  chain: Chain,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await account.isDeployed(chain)) return true
    await sleep(1_000)
  }
  return account.isDeployed(chain)
}

async function waitForSessionEnabled(
  account: RhinestoneAccount,
  session: Session,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await account.experimental_isSessionEnabled(session)) return true
    await sleep(1_000)
  }
  return account.experimental_isSessionEnabled(session)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
