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
import {
  createSolanaRpcFetch,
  type SolanaRpcError,
} from '../framework/solana/transport'

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
  const override = env.INTEGRATION_ORCHESTRATOR_URL?.replace(/\/+$/, '')
  const endpointUrl = override || SOLANA_ENDPOINTS.prod
  const service: SolanaTarget =
    endpointUrl === SOLANA_ENDPOINTS.dev ? 'dev' : 'prod'
  if (!Object.values(SOLANA_ENDPOINTS).some((url) => url === endpointUrl)) {
    errors.push(
      'INTEGRATION_ORCHESTRATOR_URL must be a known prod or dev endpoint',
    )
  }
  const contracts = env.INTEGRATION_USE_DEV_CONTRACTS
  if (contracts && contracts !== 'true' && contracts !== 'false') {
    errors.push('INTEGRATION_USE_DEV_CONTRACTS must be true or false')
  }
  const useDevContracts = contracts === 'true' || Boolean(override)
  if (
    useDevContracts !== (service === 'dev') ||
    (contracts === 'false' && service === 'dev')
  ) {
    errors.push(
      'INTEGRATION_USE_DEV_CONTRACTS conflicts with the selected orchestrator endpoint',
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
  onRpcError?: (error: SolanaRpcError) => void | Promise<void>,
): Promise<{
  config: SolanaIntegrationConfig
  connection: Connection
  evmClient: PublicClient<Transport, typeof baseSepolia>
}> {
  const connection = new Connection(config.solanaRpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: createSolanaRpcFetch({ onError: onRpcError }) as typeof fetch,
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

export const SOLANA_REPORT_PATH = '.scratch/integration/solana-report.json'

export function createSolanaReport(path = SOLANA_REPORT_PATH) {
  const entries: SolanaDiagnostic[] = []
  let writes = Promise.resolve()
  return {
    record(input: SolanaDiagnostic) {
      entries.push(safeSolanaDiagnostic(input))
    },
    write() {
      writes = writes.then(async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${JSON.stringify({ entries }, null, 2)}\n`, {
          mode: 0o600,
        })
      })
      return writes
    },
  }
}
