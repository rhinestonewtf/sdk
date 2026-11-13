import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Address, Chain, Hex } from 'viem'
import type { BuildId } from './config'

// The structural surface scenarios use. Written here rather than imported so
// neither build's types leak into the other; extend it as scenarios grow.
interface SdkAccount {
  getAddress(): Address
  prepareTransaction(transaction: unknown): Promise<unknown>
  getTransactionMessages(prepared: unknown): {
    origin: unknown[]
    destination: unknown
  }
  signTransaction(prepared: unknown): Promise<unknown>
  submitTransaction(
    signed: unknown,
    authorizations?: unknown,
    dryRun?: boolean,
  ): Promise<unknown>
  waitForExecution(
    result: unknown,
    acceptsPreconfirmations?: boolean,
  ): Promise<unknown>
  getPortfolio(onTestnets?: boolean): Promise<unknown>
  sendTransaction(transaction: unknown): Promise<unknown>
  signAuthorizations(prepared: unknown): Promise<unknown>
  signEip7702InitData(): Promise<Hex>
  isDeployed(chain: Chain): Promise<boolean>
  experimental_getSessionDetails(sessions: unknown[]): Promise<unknown>
  experimental_signEnableSession(details: unknown): Promise<Hex>
  experimental_isSessionEnabled(session: unknown): Promise<boolean>
}

interface SdkInstance {
  createAccount(config: unknown): Promise<SdkAccount>
  getIntentStatus(intentId: bigint): Promise<unknown>
  splitIntents(input: {
    chain: Chain
    tokens: Record<string, bigint>
    settlementLayers?: string[]
  }): Promise<unknown>
  getAppFeeBalances(): Promise<unknown>
}

interface SdkRoot {
  RhinestoneSDK: new (config: {
    apiKey?: string
    auth?: unknown
    endpointUrl?: string
    provider?: unknown
  }) => SdkInstance
  getTokenAddress(symbol: string, chainId: number): Address
}

interface SdkOrchestratorClient {
  getIntentOpStatus(intentId: bigint): Promise<unknown>
  getPortfolio(
    address: string,
    filter?: { chainIds?: number[]; tokens?: Record<number, string[]> },
  ): Promise<unknown>
}

// The exported low-level client (`@rhinestone/sdk/dist/src/orchestrator`).
interface SdkOrchestratorModule {
  getOrchestrator(
    auth: {
      getHeaders(): Promise<Record<string, string>>
      getSubmitHeaders(
        intentInput: unknown,
        isSponsored: boolean,
      ): Promise<Record<string, string>>
    },
    url?: string,
    headers?: Record<string, string>,
  ): SdkOrchestratorClient
}

interface LoadedBuild {
  id: BuildId
  label: string
  version: string
  commit?: string
  dirty?: boolean
  root: SdkRoot
  orchestrator: SdkOrchestratorModule
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const BASELINE_PACKAGE = '@rhinestone/sdk-v1-baseline'

const repoRequire = createRequire(join(REPO_ROOT, 'package.json'))

function viemPackagePath(fromFile: string): string {
  return createRequire(fromFile).resolve('viem/package.json')
}

function loadPublished(): LoadedBuild {
  const entry = repoRequire.resolve(BASELINE_PACKAGE)
  const packageDir = entry.slice(0, entry.indexOf('/dist/'))
  // A fresh module instance per run, so nothing cached by an earlier run leaks.
  for (const key of Object.keys(repoRequire.cache)) {
    if (key.startsWith(packageDir)) delete repoRequire.cache[key]
  }
  const manifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  )
  return {
    id: 'published',
    label: `${manifest.name}@${manifest.version} (npm)`,
    version: manifest.version,
    root: repoRequire(BASELINE_PACKAGE) as SdkRoot,
    orchestrator: repoRequire(
      `${BASELINE_PACKAGE}/dist/src/orchestrator`,
    ) as SdkOrchestratorModule,
  }
}

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

async function loadWorkingTree(): Promise<LoadedBuild> {
  const { vi } = await import('vitest')
  vi.resetModules()
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, 'src/package.json'), 'utf8'),
  )
  const root = (await import('../../src/index')) as unknown as SdkRoot
  const orchestrator = (await import(
    '../../src/orchestrator/index'
  )) as unknown as SdkOrchestratorModule
  const commit = git('rev-parse HEAD')
  const dirty = git('status --porcelain').length > 0
  return {
    id: 'working-tree',
    label: `working tree ${commit.slice(0, 10)}${dirty ? ' (dirty)' : ''}`,
    version: manifest.version,
    commit,
    dirty,
    root,
    orchestrator,
  }
}

let viemChecked = false

// Both builds must share one viem: it is a peer dependency, and a second copy
// would change `instanceof` behavior between the two sides.
function assertSharedViem(): void {
  if (viemChecked) return
  const published = viemPackagePath(repoRequire.resolve(BASELINE_PACKAGE))
  const workingTree = viemPackagePath(join(REPO_ROOT, 'src/index.ts'))
  if (published !== workingTree) {
    throw new Error(
      `Builds resolve different viem copies: ${published} vs ${workingTree}`,
    )
  }
  viemChecked = true
}

async function loadBuild(id: BuildId): Promise<LoadedBuild> {
  assertSharedViem()
  return id === 'published' ? loadPublished() : loadWorkingTree()
}

type BuildLoader = (id: BuildId) => Promise<LoadedBuild>

type TokenRequirements = Record<
  string,
  Record<string, { type: string; amount?: bigint | string }>
>

// Wrap and approval requirements an EOA must meet before submitting: the
// working tree serves them on `prepared.quote` (bigint amounts), 1.22.0 on
// `prepared.intentRoute` (string amounts).
function tokenRequirementsOf(prepared: unknown): TokenRequirements {
  const { quote, intentRoute } = (prepared ?? {}) as {
    quote?: { tokenRequirements?: unknown }
    intentRoute?: { tokenRequirements?: unknown }
  }
  return (quote?.tokenRequirements ??
    intentRoute?.tokenRequirements ??
    {}) as TokenRequirements
}

export type {
  BuildLoader,
  LoadedBuild,
  SdkAccount,
  SdkInstance,
  SdkOrchestratorClient,
  SdkOrchestratorModule,
  SdkRoot,
  TokenRequirements,
}
export { loadBuild, tokenRequirementsOf }
