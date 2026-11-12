import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Address, Chain } from 'viem'
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
}

interface SdkInstance {
  createAccount(config: unknown): Promise<SdkAccount>
  getIntentStatus(intentId: bigint): Promise<unknown>
  splitIntents(input: {
    chain: Chain
    tokens: Record<string, bigint>
  }): Promise<unknown>
  getAppFeeBalances(): Promise<unknown>
}

interface SdkRoot {
  RhinestoneSDK: new (config: {
    apiKey: string
    endpointUrl?: string
    headers?: Record<string, string>
  }) => SdkInstance
  getTokenAddress(symbol: string, chainId: number): Address
}

interface LoadedBuild {
  id: BuildId
  label: string
  version: string
  commit?: string
  dirty?: boolean
  root: SdkRoot
  subpath(name: string): Promise<Record<string, unknown>>
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
    subpath: async (name) => repoRequire(`${BASELINE_PACKAGE}/${name}`),
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
  const commit = git('rev-parse HEAD')
  const dirty = git('status --porcelain').length > 0
  return {
    id: 'working-tree',
    label: `working tree ${commit.slice(0, 10)}${dirty ? ' (dirty)' : ''}`,
    version: manifest.version,
    commit,
    dirty,
    root,
    subpath: async (name) => {
      const target = manifest.exports?.[`./${name}`]?.import as
        | string
        | undefined
      if (!target) throw new Error(`@rhinestone/sdk has no "./${name}" export`)
      // `./dist/src/x/index.js` is built from `src/x/index.ts` at the repo root.
      const source = join(
        REPO_ROOT,
        target.replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts'),
      )
      return import(/* @vite-ignore */ source)
    },
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

export type { BuildLoader, LoadedBuild, SdkAccount, SdkInstance, SdkRoot }
export { loadBuild }
