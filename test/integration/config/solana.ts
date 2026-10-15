import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Connection, Keypair } from '@solana/web3.js'
import {
  createPublicClient,
  http,
  type PublicClient,
  type Transport,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import type { RhinestoneSDKConfig } from '../../../src/config/account'
import {
  type SolanaDiagnostic,
  safeSolanaDiagnostic,
} from '../framework/solana/evidence'

export const SOLANA_DEVNET_RPC_URL = 'https://api.devnet.solana.com'
export const SOLANA_DEVNET_GENESIS =
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const SOLANA_ENDPOINTS = {
  dev: 'https://dev.v1.orchestrator.rhinestone.dev',
  prod: 'https://v1.orchestrator.rhinestone.dev',
} as const

type Environment = Record<string, string | undefined>
export type SolanaTarget = keyof typeof SOLANA_ENDPOINTS

export function parseSolanaFunderPrivateKey(
  value: string | undefined,
): Keypair {
  const message =
    'INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY must be a consistent JSON array of 64 integer bytes (0–255) from a Solana keypair'
  try {
    const bytes: unknown = JSON.parse(value ?? '')
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 64 ||
      !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      throw new Error()
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes))
  } catch {
    // Never attach the JSON parser/keypair error: it can contain secret input.
    throw new Error(message)
  }
}

export function getSolanaIntegrationConfig(env: Environment = process.env) {
  const errors: string[] = []
  const target = env.INTEGRATION_SOLANA_TARGET || 'dev'
  if (target !== 'dev' && target !== 'prod') {
    errors.push('INTEGRATION_SOLANA_TARGET must be dev or prod')
  }
  const service: SolanaTarget = target === 'prod' ? 'prod' : 'dev'
  const endpointUrl = SOLANA_ENDPOINTS[service]
  if (
    env.INTEGRATION_ORCHESTRATOR_URL &&
    env.INTEGRATION_ORCHESTRATOR_URL.replace(/\/+$/, '') !== endpointUrl
  ) {
    errors.push(
      'INTEGRATION_ORCHESTRATOR_URL conflicts with INTEGRATION_SOLANA_TARGET; remove the override',
    )
  }
  if (
    env.INTEGRATION_USE_DEV_CONTRACTS !== undefined &&
    env.INTEGRATION_USE_DEV_CONTRACTS !== String(service === 'dev')
  ) {
    errors.push(
      'INTEGRATION_USE_DEV_CONTRACTS conflicts with INTEGRATION_SOLANA_TARGET; remove the override',
    )
  }
  const apiKey = env.INTEGRATION_RHINESTONE_API_KEY
  if (!apiKey?.trim())
    errors.push(
      'INTEGRATION_RHINESTONE_API_KEY is required for the selected target',
    )
  let funder: Keypair | undefined
  try {
    funder = parseSolanaFunderPrivateKey(
      env.INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY,
    )
  } catch (error) {
    errors.push((error as Error).message)
  }
  const evmFunderPrivateKey = env.INTEGRATION_FUNDER_PRIVATE_KEY
  try {
    if (
      !evmFunderPrivateKey ||
      !/^0x[0-9a-fA-F]{64}$/.test(evmFunderPrivateKey)
    )
      throw new Error()
    privateKeyToAccount(evmFunderPrivateKey as `0x${string}`)
  } catch {
    errors.push(
      'INTEGRATION_FUNDER_PRIVATE_KEY must be a valid 0x-prefixed EVM private key for Base Sepolia',
    )
  }
  const solanaRpcUrl = env.INTEGRATION_SOLANA_RPC_URL || SOLANA_DEVNET_RPC_URL
  const baseSepoliaRpcUrl =
    env.INTEGRATION_RPC_URL_84532 || baseSepolia.rpcUrls.default.http[0]
  for (const [name, value] of [
    ['INTEGRATION_SOLANA_RPC_URL', solanaRpcUrl],
    ['INTEGRATION_RPC_URL_84532', baseSepoliaRpcUrl],
  ]) {
    try {
      if (!['https:', 'http:'].includes(new URL(value).protocol))
        throw new Error()
    } catch {
      errors.push(`${name} must be an HTTP(S) RPC URL`)
    }
  }
  if (errors.length) {
    throw new Error(
      `Solana integration prerequisites failed:\n- ${errors.join('\n- ')}`,
    )
  }
  const sdkConfig: RhinestoneSDKConfig = {
    auth: { mode: 'apiKey', apiKey: apiKey as string },
    endpointUrl,
    useDevContracts: service === 'dev',
  }
  return {
    target: service,
    endpointUrl,
    useDevContracts: service === 'dev',
    sdkConfig,
    funder: funder as Keypair,
    evmFunderPrivateKey: evmFunderPrivateKey as `0x${string}`,
    solanaRpcUrl,
    baseSepoliaRpcUrl,
  }
}

export type SolanaIntegrationConfig = ReturnType<
  typeof getSolanaIntegrationConfig
>

// Read-only preflight must complete before fixture creation, signing or funding.
export async function assertSolanaIntegrationNetworks(
  solana: { getGenesisHash(): Promise<string> },
  evm: { getChainId(): Promise<number> },
) {
  const results = await Promise.allSettled([
    solana.getGenesisHash(),
    evm.getChainId(),
  ])
  const errors: string[] = []
  if (
    results[0].status !== 'fulfilled' ||
    results[0].value !== SOLANA_DEVNET_GENESIS
  ) {
    errors.push('Solana RPC must respond with the Devnet genesis hash')
  }
  if (results[1].status !== 'fulfilled' || results[1].value !== 84532) {
    errors.push('EVM RPC must respond with Base Sepolia chain ID 84532')
  }
  if (errors.length)
    throw new Error(
      `Solana network prerequisites failed:\n- ${errors.join('\n- ')}`,
    )
}

export async function preflightSolanaIntegration(
  config = getSolanaIntegrationConfig(),
): Promise<{
  config: SolanaIntegrationConfig
  connection: Connection
  evmClient: PublicClient<Transport, typeof baseSepolia>
}> {
  const connection = new Connection(config.solanaRpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: ((input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      })) as typeof fetch,
  })
  const evmClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.baseSepoliaRpcUrl, {
      retryCount: 0,
      timeout: 30_000,
    }),
  })
  await assertSolanaIntegrationNetworks(connection, evmClient)
  return { config, connection, evmClient }
}

export const SOLANA_REPORT_PATH = '.scratch/rhi-7365/solana-report.json'

export function createSolanaReport(path = SOLANA_REPORT_PATH) {
  const entries: SolanaDiagnostic[] = []
  return {
    record(input: SolanaDiagnostic) {
      entries.push(safeSolanaDiagnostic(input))
    },
    async write() {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify({ entries }, null, 2)}\n`, {
        mode: 0o600,
      })
    },
  }
}
