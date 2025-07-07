import { setupOrchestratorMock } from './orchestrator'
import { setupViemMock } from './utils/viem'

const deployerPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const deployerAccount = privateKeyToAccount(deployerPrivateKey)

const sourceChain = base
const anvil = getAnvil(sourceChain, getForkUrl(sourceChain))

setupOrchestratorMock()
setupViemMock(anvil, deployerAccount)

import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { beforeAll, describe } from 'vitest'

import './utils/polyfill'

import { runBundlesTestCases } from './bundles'
import { runDeploymentTestCases } from './deployment'
import { getAnvil } from './utils/anvil'
import { getForkUrl } from './utils/utils'

describe.sequential('E2E Tests', () => {
  beforeAll(async () => {
    await anvil.start()
  })

  runDeploymentTestCases()
  runBundlesTestCases()
})
